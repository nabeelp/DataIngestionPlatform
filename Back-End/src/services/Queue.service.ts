// =============================================================================
// Queue Service - BullMQ + Redis Queue Management
// =============================================================================

import Bull, { Queue, Job, Worker } from 'bullmq';
import { EventEmitter } from 'events';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';
import type { IValidationJobData, IDeliveryJobData, IRetryJobData } from '../interfaces/upload.interface';

// Queue names
export const QUEUE_NAMES = {
    VALIDATION: 'validation-queue',
    DELIVERY: 'delivery-queue',
    RETRY: 'retry-queue',
    CLEANUP: 'cleanup-queue'
} as const;

// Job types
export const JOB_TYPES = {
    FILE_VALIDATION: 'FILE_VALIDATION',
    RULE_EXECUTION: 'RULE_EXECUTION',
    FILE_DELIVERY: 'FILE_DELIVERY',
    RETRY_DELIVERY: 'RETRY_DELIVERY'
} as const;

// Redis connection options
const redisConnection = {
    host: appConfig.redis.host || 'localhost',
    port: appConfig.redis.port || 6379,
    password: appConfig.redis.password,
    maxRetriesPerRequest: null, // Required for BullMQ
    connectTimeout: 3000,
    retryStrategy: (times: number) => Math.min(times * 50, 2000)
};

type LocalJob = Job & {
    state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
    finishedOn?: number;
    failedReason?: string;
    attemptsMade: number;
};

class LocalQueue {
    private jobs = new Map<string, LocalJob>();
    private processor?: (job: Job) => Promise<void>;
    private worker?: EventEmitter;
    private concurrency = 1;
    private running = 0;
    private paused = false;
    private closed = false;
    private timers = new Set<NodeJS.Timeout>();
    private nextId = 0;

    constructor(private readonly name: string) {}

    async add(name: string, data: any, opts: { jobId?: string; attempts?: number } = {}): Promise<Job> {
        if (this.closed) throw new Error(`Queue ${this.name} is closed`);
        const id = opts.jobId || String(++this.nextId);
        const existing = this.jobs.get(id);
        if (existing && existing.state !== 'completed' && existing.state !== 'failed') return existing;
        const job: LocalJob = {
            id, name, data, opts, timestamp: Date.now(), state: 'waiting' as const,
            attemptsMade: 0,
            moveToFailed: async (error: Error) => {
                job.state = 'failed';
                job.failedReason = error.message;
                job.finishedOn = Date.now();
                this.worker?.emit('failed', job, error);
            }
        } as unknown as LocalJob;
        this.jobs.set(id, job);
        this.schedule();
        return job;
    }

    async addBulk(items: Array<{ name: string; data: any; opts?: { jobId?: string; attempts?: number } }>): Promise<Job[]> {
        return Promise.all(items.map(item => this.add(item.name, item.data, item.opts)));
    }

    start(processor: (job: Job) => Promise<void>, worker: EventEmitter, concurrency: number): void {
        this.processor = processor;
        this.worker = worker;
        this.concurrency = Math.max(1, concurrency);
        this.schedule();
    }

    stop(worker: EventEmitter): void {
        if (this.worker === worker) {
            this.processor = undefined;
            this.worker = undefined;
        }
    }

    private schedule(): void {
        if (this.closed || this.paused || !this.processor) return;
        setImmediate(() => void this.run());
    }

    private run(): void {
        while (!this.closed && !this.paused && this.processor && this.running < this.concurrency) {
            const job = [...this.jobs.values()].find(item => item.state === 'waiting');
            if (!job) break;
            job.state = 'active';
            job.processedOn = Date.now();
            this.running++;
            const processor = this.processor;
            const worker = this.worker;
            void (async () => {
                try {
                    if (job.attemptsMade === 0) await this.waitUntilReady(job);
                    if (job.state !== 'active') return;
                    await processor(job);
                    if (job.state === 'active') {
                        job.state = 'completed';
                        job.finishedOn = Date.now();
                        worker?.emit('completed', job);
                    }
                } catch (error) {
                    if (job.state !== 'active') return;
                    job.attemptsMade++;
                    const attempts = job.opts.attempts ?? (this.name === QUEUE_NAMES.RETRY ? 5 : 3);
                    if (job.attemptsMade < attempts && !this.closed) {
                        job.state = 'delayed';
                        const delay = (this.name === QUEUE_NAMES.RETRY ? 10000 : 5000) * 2 ** (job.attemptsMade - 1);
                        const timer = setTimeout(() => {
                            this.timers.delete(timer);
                            if (job.state === 'delayed') {
                                job.state = 'waiting';
                                this.schedule();
                            }
                        }, delay);
                        this.timers.add(timer);
                        logger.warn(`Local ${this.name} job ${job.id} failed; retrying in ${delay}ms`, error);
                    } else {
                        job.state = 'failed';
                        job.failedReason = String(error);
                        job.finishedOn = Date.now();
                        logger.error(`Local ${this.name} job ${job.id} failed permanently`, error);
                        worker?.emit('failed', job, error);
                    }
                } finally {
                    this.running--;
                    this.schedule();
                }
            })();
        }
    }

    private async waitUntilReady(job: LocalJob): Promise<void> {
        if (this.name !== QUEUE_NAMES.VALIDATION && this.name !== QUEUE_NAMES.DELIVERY) return;
        const { Upload } = await import('../models/Upload.model');
        const expected = this.name === QUEUE_NAMES.VALIDATION ? 'VALIDATION_IN_PROGRESS' : 'DELIVERY_IN_PROGRESS';
        const deadline = Date.now() + (appConfig.workers.jobTimeout || 60000);
        while (!this.closed && job.state === 'active') {
            const upload = await Upload.findById(job.data.uploadId);
            if (upload?.Status === expected) return;
            if (Date.now() >= deadline) throw new Error(`Upload ${job.data.uploadId} did not reach ${expected}`);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Local queue ${this.name} stopped before job processing`);
    }

    async getWaitingCount() { return this.count('waiting'); }
    async getActiveCount() { return this.count('active'); }
    async getCompletedCount() { return this.count('completed'); }
    async getFailedCount() { return this.count('failed'); }
    async getDelayedCount() { return this.count('delayed'); }
    private count(state: LocalJob['state']) { return [...this.jobs.values()].filter(job => job.state === state).length; }
    async getJob(id: string) { return this.jobs.get(id); }
    async getFailed(start = 0, end = 10) { return [...this.jobs.values()].filter(job => job.state === 'failed').slice(start, end + 1); }
    async getActive() { return [...this.jobs.values()].filter(job => job.state === 'active'); }
    async pause() { this.paused = true; }
    async resume() { this.paused = false; this.schedule(); }
    async drain() {
        for (const [id, job] of this.jobs) if (job.state === 'waiting' || job.state === 'delayed') this.jobs.delete(id);
    }
    async clean(grace: number, _limit: number, status: 'completed' | 'failed') {
        const removed: string[] = [];
        for (const [id, job] of this.jobs) {
            if (job.state === status && job.finishedOn && Date.now() - job.finishedOn >= grace) {
                this.jobs.delete(id);
                removed.push(id);
                if (removed.length === 100) break;
            }
        }
        return removed;
    }
    async close() {
        this.closed = true;
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        this.processor = undefined;
    }
}

const localQueues = new Map<string, LocalQueue>();
function localWorker(name: string, processor: (job: Job) => Promise<void>, concurrency: number): Worker {
    const queue = localQueues.get(name);
    if (!queue) throw new Error(`Local queue ${name} not initialized`);
    const worker = new EventEmitter() as EventEmitter & { close: () => Promise<void> };
    worker.close = async () => queue.stop(worker);
    queue.start(processor, worker, concurrency);
    return worker as unknown as Worker;
}

// Queue instances
let validationQueue: Queue | null = null;
let deliveryQueue: Queue | null = null;
let retryQueue: Queue | null = null;
let cleanupQueue: Queue | null = null;

// Worker instances
let validationWorker: Worker | null = null;
let deliveryWorker: Worker | null = null;
let retryWorker: Worker | null = null;

/**
 * Initialize all queues
 */
export async function initializeQueues(): Promise<void> {
    if (!appConfig.redis.enabled) {
        for (const name of Object.values(QUEUE_NAMES)) {
            if (!localQueues.has(name)) localQueues.set(name, new LocalQueue(name));
        }
        validationQueue = localQueues.get(QUEUE_NAMES.VALIDATION)! as unknown as Queue;
        deliveryQueue = localQueues.get(QUEUE_NAMES.DELIVERY)! as unknown as Queue;
        retryQueue = localQueues.get(QUEUE_NAMES.RETRY)! as unknown as Queue;
        cleanupQueue = localQueues.get(QUEUE_NAMES.CLEANUP)! as unknown as Queue;
        logger.info('In-process queues initialized (REDIS_ENABLED=false)');
        return;
    }
    try {
        // Create queues
        validationQueue = new Queue(QUEUE_NAMES.VALIDATION, {
            connection: redisConnection,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000
                },
                removeOnComplete: {
                    age: 3600, // 1 hour
                    count: 1000
                },
                removeOnFail: {
                    age: 86400, // 24 hours
                    count: 5000
                }
            }
        });

        deliveryQueue = new Queue(QUEUE_NAMES.DELIVERY, {
            connection: redisConnection,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000
                },
                removeOnComplete: {
                    age: 3600,
                    count: 1000
                },
                removeOnFail: {
                    age: 86400,
                    count: 5000
                }
            }
        });

        retryQueue = new Queue(QUEUE_NAMES.RETRY, {
            connection: redisConnection,
            defaultJobOptions: {
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 10000
                },
                removeOnComplete: {
                    age: 3600,
                    count: 1000
                },
                removeOnFail: false // Keep failed retries for manual intervention
            }
        });

        cleanupQueue = new Queue(QUEUE_NAMES.CLEANUP, {
            connection: redisConnection,
            defaultJobOptions: {
                attempts: 1,
                removeOnComplete: true,
                removeOnFail: false
            }
        });

        let timeout: NodeJS.Timeout | undefined;
        try {
            await Promise.race([
                Promise.all([validationQueue, deliveryQueue, retryQueue, cleanupQueue].map(queue => queue!.waitUntilReady())),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Redis connection timed out')), 5000);
                })
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
        logger.info('All queues initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize queues:', error);
        await closeAllQueues();
        throw new Error(`REDIS_ENABLED=true but BullMQ queues cannot connect to Redis: ${String(error)}`);
    }
}

/**
 * Get validation queue instance
 */
export function getValidationQueue(): Queue {
    if (!validationQueue) {
        throw new Error('Validation queue not initialized');
    }
    return validationQueue;
}

/**
 * Get delivery queue instance
 */
export function getDeliveryQueue(): Queue {
    if (!deliveryQueue) {
        throw new Error('Delivery queue not initialized');
    }
    return deliveryQueue;
}

/**
 * Get retry queue instance
 */
export function getRetryQueue(): Queue {
    if (!retryQueue) {
        throw new Error('Retry queue not initialized');
    }
    return retryQueue;
}

/**
 * Get cleanup queue instance
 */
export function getCleanupQueue(): Queue {
    if (!cleanupQueue) {
        throw new Error('Cleanup queue not initialized');
    }
    return cleanupQueue;
}

// ============================================================================
// Validation Queue Operations
// ============================================================================

/**
 * Add validation job to queue
 */
export async function addValidationJob(data: IValidationJobData): Promise<Job> {
    const queue = getValidationQueue();
    
    const job = await queue.add(
        JOB_TYPES.FILE_VALIDATION,
        data,
        {
            jobId: data.uploadId,
            priority: 1 // High priority
        }
    );

    logger.info(`[QUEUE-ADDVAL] UploadId: ${data.uploadId}, JobId: ${job.id}`);
    return job;
}

/**
 * Add multiple validation jobs (for parallel processing)
 */
export async function addValidationJobs(dataList: IValidationJobData[]): Promise<Job[]> {
    const queue = getValidationQueue();
    
    const jobs = await queue.addBulk(
        dataList.map(data => ({
            name: JOB_TYPES.FILE_VALIDATION,
            data,
            opts: {
                jobId: data.uploadId,
                priority: 1
            }
        }))
    );

    logger.info(`Added ${jobs.length} validation jobs to queue`);
    return jobs;
}

// ============================================================================
// Delivery Queue Operations
// ============================================================================

/**
 * Add delivery job to queue
 */
export async function addDeliveryJob(data: IDeliveryJobData): Promise<Job> {
    const queue = getDeliveryQueue();
    
    const job = await queue.add(
        JOB_TYPES.FILE_DELIVERY,
        data,
        {
            jobId: `${data.uploadId}-${data.deliveryType}`
        }
    );

    logger.info(`Delivery job added: ${job.id} for upload ${data.uploadId}`);
    return job;
}

/**
 * Add multiple delivery jobs for different targets
 */
export async function addDeliveryJobs(dataList: IDeliveryJobData[]): Promise<Job[]> {
    const queue = getDeliveryQueue();
    
    const jobs = await queue.addBulk(
        dataList.map(data => ({
            name: JOB_TYPES.FILE_DELIVERY,
            data,
            opts: {
                jobId: `${data.uploadId}-${data.uploadSheetId}-${data.deliveryType}`
            }
        }))
    );

    logger.info(`Added ${jobs.length} delivery jobs to queue`);
    return jobs;
}

// ============================================================================
// Retry Queue Operations
// ============================================================================

/**
 * Add retry job to queue
 */
export async function addRetryJob(data: IRetryJobData): Promise<Job> {
    const queue = getRetryQueue();
    
    const job = await queue.add(
        'retry-job',
        data,
        {
            jobId: `retry-${data.uploadId}-${Date.now()}`,
            attempts: data.retryCount
        }
    );

    logger.info(`Retry job added: ${job.id} for upload ${data.uploadId}`);
    return job;
}

// ============================================================================
// Queue Status & Monitoring
// ============================================================================

/**
 * Get queue statistics
 */
export async function getQueueStats(queueName: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
}> {
    let queue: Queue;
    
    switch (queueName) {
        case QUEUE_NAMES.VALIDATION:
            queue = getValidationQueue();
            break;
        case QUEUE_NAMES.DELIVERY:
            queue = getDeliveryQueue();
            break;
        case QUEUE_NAMES.RETRY:
            queue = getRetryQueue();
            break;
        default:
            throw new Error(`Unknown queue: ${queueName}`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount()
    ]);

    return { waiting, active, completed, failed, delayed };
}

/**
 * Get all queue statistics
 */
export async function getAllQueueStats(): Promise<Record<string, {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
}>> {
    const [validation, delivery, retry] = await Promise.all([
        getQueueStats(QUEUE_NAMES.VALIDATION),
        getQueueStats(QUEUE_NAMES.DELIVERY),
        getQueueStats(QUEUE_NAMES.RETRY)
    ]);

    return {
        validation,
        delivery,
        retry
    };
}

/**
 * Get job by ID from a queue
 */
export async function getJobFromQueue(queueName: string, jobId: string): Promise<Job | undefined> {
    let queue: Queue;
    
    switch (queueName) {
        case QUEUE_NAMES.VALIDATION:
            queue = getValidationQueue();
            break;
        case QUEUE_NAMES.DELIVERY:
            queue = getDeliveryQueue();
            break;
        case QUEUE_NAMES.RETRY:
            queue = getRetryQueue();
            break;
        default:
            throw new Error(`Unknown queue: ${queueName}`);
    }

    return await queue.getJob(jobId);
}

/**
 * Get failed jobs
 */
export async function getFailedJobs(queueName: string, start = 0, end = 10): Promise<Job[]> {
    let queue: Queue;
    
    switch (queueName) {
        case QUEUE_NAMES.VALIDATION:
            queue = getValidationQueue();
            break;
        case QUEUE_NAMES.DELIVERY:
            queue = getDeliveryQueue();
            break;
        case QUEUE_NAMES.RETRY:
            queue = getRetryQueue();
            break;
        default:
            throw new Error(`Unknown queue: ${queueName}`);
    }

    return await queue.getFailed(start, end);
}

// ============================================================================
// Queue Control Operations
// ============================================================================

/**
 * Timeout error message for stuck jobs
 */
const TIMEOUT_ERROR_MESSAGE = 'Job timed out - exceeded maximum execution time';

/**
 * Fail jobs that have been stuck/active for longer than the timeout
 * This helps prevent jobs from blocking the queue indefinitely
 */
export async function failStuckJobs(timeoutMs?: number): Promise<{
    validationJobsFailed: number;
    deliveryJobsFailed: number;
    details: Array<{
        jobId: string;
        queueName: string;
        uploadId: string;
        stuckDurationMs: number;
    }>;
}> {
    const timeout = timeoutMs || appConfig.workers.jobTimeout || 60000;
    const now = Date.now();
    
    const failedDetails: Array<{
        jobId: string;
        queueName: string;
        uploadId: string;
        stuckDurationMs: number;
    }> = [];
    
    let validationJobsFailed = 0;
    let deliveryJobsFailed = 0;

    try {
        // Check validation queue for stuck jobs
        if (validationQueue) {
            const activeValidationJobs = await validationQueue.getActive();
            
            for (const job of activeValidationJobs) {
                const jobData = job.data as IValidationJobData;
                const processedOn = job.processedOn;
                
                if (processedOn) {
                    const stuckDurationMs = now - processedOn;
                    
                    if (stuckDurationMs > timeout) {
                        const error = new Error(`${TIMEOUT_ERROR_MESSAGE} (stuck for ${Math.round(stuckDurationMs / 1000)}s)`);
                        await job.moveToFailed(error, job.token || '');
                        
                        failedDetails.push({
                            jobId: job.id || 'unknown',
                            queueName: QUEUE_NAMES.VALIDATION,
                            uploadId: jobData?.uploadId || 'unknown',
                            stuckDurationMs
                        });
                        
                        validationJobsFailed++;
                        logger.warn(`Validation job ${job.id} failed due to timeout (stuck for ${Math.round(stuckDurationMs / 1000)}s)`);
                    }
                }
            }
        }

        // Check delivery queue for stuck jobs
        if (deliveryQueue) {
            const activeDeliveryJobs = await deliveryQueue.getActive();
            
            for (const job of activeDeliveryJobs) {
                const jobData = job.data as IDeliveryJobData;
                const processedOn = job.processedOn;
                
                if (processedOn) {
                    const stuckDurationMs = now - processedOn;
                    
                    if (stuckDurationMs > timeout) {
                        const error = new Error(`${TIMEOUT_ERROR_MESSAGE} (stuck for ${Math.round(stuckDurationMs / 1000)}s)`);
                        await job.moveToFailed(error, job.token || '');
                        
                        failedDetails.push({
                            jobId: job.id || 'unknown',
                            queueName: QUEUE_NAMES.DELIVERY,
                            uploadId: jobData?.uploadId || 'unknown',
                            stuckDurationMs
                        });
                        
                        deliveryJobsFailed++;
                        logger.warn(`Delivery job ${job.id} failed due to timeout (stuck for ${Math.round(stuckDurationMs / 1000)}s)`);
                    }
                }
            }
        }

        logger.info(`Stuck job check completed: ${validationJobsFailed} validation, ${deliveryJobsFailed} delivery jobs failed`);
        
        return {
            validationJobsFailed,
            deliveryJobsFailed,
            details: failedDetails
        };
    } catch (error) {
        logger.error('Error while checking for stuck jobs:', error);
        throw error;
    }
}

/**
 * Get stuck jobs (active jobs that have been running longer than timeout)
 */
export async function getStuckJobs(timeoutMs?: number): Promise<{
    validationJobs: Array<{
        jobId: string;
        uploadId: string;
        stuckDurationMs: number;
        startedAt: number;
    }>;
    deliveryJobs: Array<{
        jobId: string;
        uploadId: string;
        stuckDurationMs: number;
        startedAt: number;
    }>;
}> {
    const timeout = timeoutMs || appConfig.workers.jobTimeout || 60000;
    const now = Date.now();
    
    const validationJobs: Array<{
        jobId: string;
        uploadId: string;
        stuckDurationMs: number;
        startedAt: number;
    }> = [];
    
    const deliveryJobs: Array<{
        jobId: string;
        uploadId: string;
        stuckDurationMs: number;
        startedAt: number;
    }> = [];

    try {
        // Check validation queue
        if (validationQueue) {
            const activeValidationJobs = await validationQueue.getActive();
            
            for (const job of activeValidationJobs) {
                const jobData = job.data as IValidationJobData;
                const processedOn = job.processedOn;
                
                if (processedOn) {
                    const stuckDurationMs = now - processedOn;
                    
                    if (stuckDurationMs > timeout) {
                        validationJobs.push({
                            jobId: job.id || 'unknown',
                            uploadId: jobData?.uploadId || 'unknown',
                            stuckDurationMs,
                            startedAt: processedOn
                        });
                    }
                }
            }
        }

        // Check delivery queue
        if (deliveryQueue) {
            const activeDeliveryJobs = await deliveryQueue.getActive();
            
            for (const job of activeDeliveryJobs) {
                const jobData = job.data as IDeliveryJobData;
                const processedOn = job.processedOn;
                
                if (processedOn) {
                    const stuckDurationMs = now - processedOn;
                    
                    if (stuckDurationMs > timeout) {
                        deliveryJobs.push({
                            jobId: job.id || 'unknown',
                            uploadId: jobData?.uploadId || 'unknown',
                            stuckDurationMs,
                            startedAt: processedOn
                        });
                    }
                }
            }
        }

        return { validationJobs, deliveryJobs };
    } catch (error) {
        logger.error('Error while getting stuck jobs:', error);
        throw error;
    }
}

/**
 * Pause a queue
 */
export async function pauseQueue(queueName: string): Promise<void> {
    let queue: Queue;
    
    switch (queueName) {
        case QUEUE_NAMES.VALIDATION:
            queue = getValidationQueue();
            break;
        case QUEUE_NAMES.DELIVERY:
            queue = getDeliveryQueue();
            break;
        case QUEUE_NAMES.RETRY:
            queue = getRetryQueue();
            break;
        default:
            throw new Error(`Unknown queue: ${queueName}`);
    }

    await queue.pause();
    logger.info(`Queue paused: ${queueName}`);
}

/**
 * Resume a queue
 */
export async function resumeQueue(queueName: string): Promise<void> {
    let queue: Queue;
    
    switch (queueName) {
        case QUEUE_NAMES.VALIDATION:
            queue = getValidationQueue();
            break;
        case QUEUE_NAMES.DELIVERY:
            queue = getDeliveryQueue();
            break;
        case QUEUE_NAMES.RETRY:
            queue = getRetryQueue();
            break;
        default:
            throw new Error(`Unknown queue: ${queueName}`);
    }

    await queue.resume();
    logger.info(`Queue resumed: ${queueName}`);
}

/**
 * Drain a queue (remove all waiting jobs)
 */
export async function drainQueue(queueName: string): Promise<void> {
    let queue: Queue;
    
    switch (queueName) {
        case QUEUE_NAMES.VALIDATION:
            queue = getValidationQueue();
            break;
        case QUEUE_NAMES.DELIVERY:
            queue = getDeliveryQueue();
            break;
        case QUEUE_NAMES.RETRY:
            queue = getRetryQueue();
            break;
        default:
            throw new Error(`Unknown queue: ${queueName}`);
    }

    await queue.drain();
    logger.info(`Queue drained: ${queueName}`);
}

/**
 * Clean old jobs from a queue
 */
export async function cleanOldJobs(
    queueName: string, 
    grace: number = 86400, 
    status: 'completed' | 'failed' = 'completed'
): Promise<string[]> {
    let queue: Queue;
    
    switch (queueName) {
        case QUEUE_NAMES.VALIDATION:
            queue = getValidationQueue();
            break;
        case QUEUE_NAMES.DELIVERY:
            queue = getDeliveryQueue();
            break;
        case QUEUE_NAMES.RETRY:
            queue = getRetryQueue();
            break;
        default:
            throw new Error(`Unknown queue: ${queueName}`);
    }

    const cleaned = await queue.clean(grace, 100, status);
    logger.info(`Cleaned ${cleaned.length} ${status} jobs from ${queueName}`);
    return cleaned;
}

// ============================================================================
// Worker Management
// ============================================================================

/**
 * Create validation worker
 */
export function createValidationWorker(
    processor: (job: Job<IValidationJobData>) => Promise<void>
): Worker {
    validationWorker = !appConfig.redis.enabled
        ? localWorker(QUEUE_NAMES.VALIDATION, processor as (job: Job) => Promise<void>, appConfig.workers.validation?.concurrency || 5)
        : new Worker(QUEUE_NAMES.VALIDATION, processor, {
        connection: redisConnection,
        concurrency: appConfig.workers.validation?.concurrency || 5,
        limiter: {
            max: appConfig.workers.validation?.maxJobsPerSecond || 10,
            duration: 1000
        }
    });

    validationWorker.on('completed', (job) => {
        logger.info(`Validation job completed: ${job.id}`);
    });

    validationWorker.on('failed', (job, err) => {
        logger.error(`Validation job failed: ${job?.id}`, err);
    });

    validationWorker.on('error', (err) => {
        logger.error('Validation worker error:', err);
    });

    return validationWorker;
}

/**
 * Create delivery worker
 */
export function createDeliveryWorker(
    processor: (job: Job<IDeliveryJobData>) => Promise<void>
): Worker {
    deliveryWorker = !appConfig.redis.enabled
        ? localWorker(QUEUE_NAMES.DELIVERY, processor as (job: Job) => Promise<void>, appConfig.workers.delivery?.concurrency || 5)
        : new Worker(QUEUE_NAMES.DELIVERY, processor, {
        connection: redisConnection,
        concurrency: appConfig.workers.delivery?.concurrency || 5,
        limiter: {
            max: appConfig.workers.delivery?.maxJobsPerSecond || 10,
            duration: 1000
        }
    });

    deliveryWorker.on('completed', (job) => {
        logger.info(`Delivery job completed: ${job.id}`);
    });

    deliveryWorker.on('failed', (job, err) => {
        logger.error(`Delivery job failed: ${job?.id}`, err);
    });

    deliveryWorker.on('error', (err) => {
        logger.error('Delivery worker error:', err);
    });

    return deliveryWorker;
}

/**
 * Create retry worker
 */
export function createRetryWorker(
    processor: (job: Job<IRetryJobData>) => Promise<void>
): Worker {
    retryWorker = !appConfig.redis.enabled
        ? localWorker(QUEUE_NAMES.RETRY, processor as (job: Job) => Promise<void>, 2)
        : new Worker(QUEUE_NAMES.RETRY, processor, {
        connection: redisConnection,
        concurrency: 2
    });

    retryWorker.on('completed', (job) => {
        logger.info(`Retry job completed: ${job.id}`);
    });

    retryWorker.on('failed', (job, err) => {
        logger.error(`Retry job failed: ${job?.id}`, err);
    });

    return retryWorker;
}

/**
 * Close all workers
 */
export async function closeAllWorkers(): Promise<void> {
    if (validationWorker) {
        await validationWorker.close();
        validationWorker = null;
    }
    if (deliveryWorker) {
        await deliveryWorker.close();
        deliveryWorker = null;
    }
    if (retryWorker) {
        await retryWorker.close();
        retryWorker = null;
    }
    logger.info('All workers closed');
}

/**
 * Close all queues and workers
 */
export async function closeAllQueues(): Promise<void> {
    await closeAllWorkers();

    if (validationQueue) {
        await validationQueue.close();
        validationQueue = null;
    }
    if (deliveryQueue) {
        await deliveryQueue.close();
        deliveryQueue = null;
    }
    if (retryQueue) {
        await retryQueue.close();
        retryQueue = null;
    }
    if (cleanupQueue) {
        await cleanupQueue.close();
        cleanupQueue = null;
    }
    localQueues.clear();

    logger.info('All queues closed');
}
