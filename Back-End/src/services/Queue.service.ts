// =============================================================================
// Queue Service - BullMQ + Redis Queue Management
// =============================================================================

import Bull, { Queue, Job, Worker } from 'bullmq';
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
    maxRetriesPerRequest: null // Required for BullMQ
};

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

        logger.info('All queues initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize queues:', error);
        throw error;
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
                        await job.moveToFailed(error);
                        
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
                        await job.moveToFailed(error);
                        
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
    validationWorker = new Worker(QUEUE_NAMES.VALIDATION, processor, {
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
    deliveryWorker = new Worker(QUEUE_NAMES.DELIVERY, processor, {
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
    retryWorker = new Worker(QUEUE_NAMES.RETRY, processor, {
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

    logger.info('All queues closed');
}

