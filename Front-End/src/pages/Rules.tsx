import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Search, MoreVertical, Edit2,
  Copy, Power, Shield, Database, LayoutGrid, AlertTriangle, 
  RefreshCw, ChevronRight, X, Trash2, Settings, Sparkles, Check,
} from 'lucide-react';
import { apiConfig } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { Link, useSearchParams } from 'react-router-dom';
import { getFileDefinitionsAdmin } from '../services/adminApi';
import {
  regenerateNaturalLanguageRule,
  reviewNaturalLanguageRule,
  runUploadDryRun,
  testNaturalLanguageRuleExamples,
  validateRuleConfig,
  type ReviewActivity,
  type RuleConfigValidationResult,
  type RuleExampleTestResult,
} from '../services/ruleAuthoringApi';
import { getRecentUploads } from '../services/uploadApi';
import type { RuleConfig } from '../contracts/rule-config';
import type { DefinitionContract } from '../contracts/definition-contract';
import {
  defaultRuleParams,
  ruleConfigColumns,
  ruleConfigExpression,
  ruleConfigFromForm,
  ruleConfigTypeLabel,
  updateRuleConfigFromForm,
} from '../services/ruleConfig';
import RuleConfigDetails from './RuleConfigDetails';
import RuleConfigFields from './RuleConfigFields';
import NaturalLanguageExamplesEditor, { type NaturalLanguageExample } from './NaturalLanguageExamplesEditor';
import RuleReviewActivity from './RuleReviewActivity';
import DefinitionContextCard from '../components/DefinitionContextCard';
import { getFileDefinitions, mapDefinitionSummary, type DefinitionSummary } from '../services/definitionApi';

//#region INTERFACES & TYPES
interface Rule {
  id: string;
  fileDefinitionId: string;
  name: string;
  description: string;
  executionOrder: number;
  ruleType: string;
  severity: string;
  sqlQuery: string;
  isEnabled: boolean;
  tableName: string | null;
  createdBy?: string | null;
  creatorName?: string;
  naturalLanguageText?: string | null;
  explanation?: string | null;
  config: RuleConfig;
}

type GenerationResult =
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'mapped' | 'natural_language'; reason: string; config: RuleConfig };

interface Definition extends DefinitionSummary {
  /** Sheet tables rules can target (empty for single-table definitions). */
  sheets: string[];
  lookups: string[];
}

interface FormState {
  name: string;
  executionOrder: string;
  description: string;
  ruleType: RuleConfig['type'];
  severity: string;
  isEnabled: boolean;
  tableName: string;
  params: Record<string, unknown>;
}

const naturalLanguageExamples = (params: Record<string, unknown>): NaturalLanguageExample[] => {
  if (!Array.isArray(params.examples)) return [];
  return params.examples.flatMap((item): NaturalLanguageExample[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const example = item as Record<string, unknown>;
    const values = example.values;
    if (typeof example.table !== 'string' || typeof example.expectedValid !== 'boolean' ||
      !values || typeof values !== 'object' || Array.isArray(values) ||
      Object.values(values).some(value => typeof value !== 'string')) return [];
    return [{
      table: example.table,
      expectedValid: example.expectedValid,
      values: values as Record<string, string>,
      source: example.source === 'admin' ? 'admin' : 'model',
    }];
  });
};
//#endregion

const RULE_TYPES = [
  { value: 'columnsPresent', label: 'Required columns' },
  { value: 'required', label: 'Required values' },
  { value: 'type', label: 'Data type' },
  { value: 'enum', label: 'Allowed values' },
  { value: 'range', label: 'Numeric range' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'length', label: 'Length' },
  { value: 'unique', label: 'Unique values' },
  { value: 'lookup', label: 'Lookup' },
  { value: 'dateRange', label: 'Date range' },
  { value: 'conditionalRequired', label: 'Conditional required values' },
  { value: 'compare', label: 'Compare columns' },
  { value: 'rowCount', label: 'Row count' },
  { value: 'aggregate', label: 'Aggregate' },
  { value: 'reconcile', label: 'Reconcile tables' },
] as const satisfies ReadonlyArray<{ value: Exclude<RuleConfig['type'], 'naturalLanguage'>; label: string }>;
const DEFAULT_RULE_TYPE = RULE_TYPES[0].value;
const NATURAL_LANGUAGE_STRATEGY: RuleConfig['type'] = 'naturalLanguage';
const isGeneratedRule = (rule: Pick<Rule, 'config'> | null | undefined) => rule?.config.type === 'naturalLanguage';

export default function ValidationRules() {
  const { token, user } = useAuth();
  const canManageRules = user?.Role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();

  //#region STATE MANAGERS
  const [rules, setRules] = useState<Rule[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string>(() => searchParams.get('definitionId') ?? '');
  
  // Loaders & Errors
  const [definitionsLoading, setDefinitionsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('Never');
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [naturalLanguageRequest, setNaturalLanguageRequest] = useState('');
  const [generatingRule, setGeneratingRule] = useState(false);
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [activity, setActivity] = useState<ReviewActivity[]>([]);
  const [reviewStartedAt, setReviewStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reviewAbort = useRef<AbortController | null>(null);
  const validationRequestId = useRef(0);
  const [ruleValidation, setRuleValidation] = useState<RuleConfigValidationResult | null>(null);
  const [ruleValidationError, setRuleValidationError] = useState<string | null>(null);
  const [validatingRule, setValidatingRule] = useState(false);
  const [exampleTest, setExampleTest] = useState<RuleExampleTestResult | null>(null);
  const [testingExamples, setTestingExamples] = useState(false);
  const [recentUploads, setRecentUploads] = useState<Array<{
    Id: string;
    FileDefinitionId: string;
    OriginalFilename: string;
    Status: string;
  }>>([]);
  const [selectedDryRunUploadId, setSelectedDryRunUploadId] = useState('');
  const [dryRunResult, setDryRunResult] = useState<Record<string, unknown> | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [runningDryRun, setRunningDryRun] = useState(false);

  // Search & Filter UI State
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'ERROR' | 'WARNING'>('ALL');

  // Slide-over Drawer UI State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Form Field State
  const [formData, setFormData] = useState<FormState>({
    name: '',
    executionOrder: '8',
    description: '',
    ruleType: DEFAULT_RULE_TYPE,
    severity: 'Error',
    isEnabled: true,
    tableName: '',
    params: defaultRuleParams(DEFAULT_RULE_TYPE),
  });
  //#endregion

  const selectedSheets = definitions.find(def => def.id === selectedDefinitionId)?.sheets ?? [];
  const selectedLookupIds = definitions.find(def => def.id === selectedDefinitionId)?.lookups ?? [];
  const selectedDefinition = definitions.find(def => def.id === selectedDefinitionId) ?? null;
  const handleDefinitionChange = (definitionId: string) => {
    setSelectedDefinitionId(definitionId);
    const next = new URLSearchParams(searchParams);
    if (definitionId) next.set('definitionId', definitionId);
    else next.delete('definitionId');
    setSearchParams(next, { replace: true });
  };
  // A plain-language review saved a rule: the drawer offers Done / Create another instead of reviewing again.
  const ruleCreated = !editingRule && formData.ruleType === NATURAL_LANGUAGE_STRATEGY
    && generationResult !== null && generationResult.outcome !== 'rejected';

  //#region LIFECYCLE EFFECTS
  // Initialization: Fetch definitions
  useEffect(() => {
    fetchDefinitions();
  }, []);

  // Sync rules list whenever target definition changes
  useEffect(() => {
    setGenerationResult(null);
    if (selectedDefinitionId) {
      fetchRules(selectedDefinitionId);
    } else {
      setRules([]);
    }
  }, [selectedDefinitionId]);

  // Sync Form data state when drawer toggles or swaps context
  useEffect(() => {
    setNaturalLanguageRequest(editingRule?.naturalLanguageText ?? editingRule?.description ?? '');
    setGenerationResult(null);
    setActivity([]);
    if (editingRule) {
      setFormData({
        name: editingRule.name || '',
        executionOrder: editingRule.executionOrder?.toString() || '8',
        description: editingRule.description || '',
        ruleType: editingRule.config.type,
        severity: editingRule.severity || 'Error',
        isEnabled: editingRule.isEnabled !== false,
        tableName: editingRule.tableName || '',
        params: editingRule.config.params as Record<string, unknown>,
      });
    } else {
      setFormData({
        name: '',
        executionOrder: '8',
        description: '',
        ruleType: DEFAULT_RULE_TYPE,
        severity: 'Error',
        isEnabled: true,
        tableName: '',
        params: defaultRuleParams(DEFAULT_RULE_TYPE),
      });
    }
  }, [editingRule, isDrawerOpen]);

  // Tick the review timer so the drawer visibly counts while the model works.
  useEffect(() => {
    if (!generatingRule) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [generatingRule]);

  // Leaving the page stops a running review, so the server does not keep calling the model.
  useEffect(() => () => reviewAbort.current?.abort(), []);

  useEffect(() => {
    const requestId = ++validationRequestId.current;
    if (!isDrawerOpen || !selectedDefinitionId || formData.ruleType === 'naturalLanguage' && !editingRule ||
      !formData.name.trim()) {
      setRuleValidation(null);
      setRuleValidationError(null);
      setValidatingRule(false);
      return;
    }

    setRuleValidation(null);
    setRuleValidationError(null);
    const timer = window.setTimeout(() => {
      const form = {
        id: editingRule?.config.id ?? 'rule-preview',
        name: formData.name,
        description: formData.description,
        executionOrder: Number.parseInt(formData.executionOrder, 10) || 0,
        severity: formData.severity as 'Error' | 'Warning',
        enabled: formData.isEnabled,
        ruleType: formData.ruleType,
        params: formData.params,
        table: selectedSheets.length > 0 ? formData.tableName || null : null,
      };
      let config: RuleConfig;
      try {
        config = editingRule
          ? updateRuleConfigFromForm(editingRule.config, form)
          : ruleConfigFromForm(form);
      } catch (error) {
        setRuleValidationError(error instanceof Error ? error.message : 'Rule configuration is incomplete.');
        return;
      }
      setValidatingRule(true);
      void validateRuleConfig(apiConfig.getBaseUrl(), token, selectedDefinitionId, config)
        .then(result => {
          if (validationRequestId.current === requestId) setRuleValidation(result);
        })
        .catch(error => {
          if (validationRequestId.current === requestId) {
            setRuleValidationError(error instanceof Error ? error.message : 'Could not validate the rule.');
          }
        })
        .finally(() => {
          if (validationRequestId.current === requestId) setValidatingRule(false);
        });
    }, 400);

    return () => {
      window.clearTimeout(timer);
      if (validationRequestId.current === requestId) validationRequestId.current += 1;
    };
  }, [editingRule, formData, isDrawerOpen, selectedDefinitionId, selectedSheets.length, token]);

  useEffect(() => {
    if (!isDrawerOpen || editingRule?.config.type !== 'naturalLanguage' || !selectedDefinitionId) {
      setRecentUploads([]);
      setSelectedDryRunUploadId('');
      setDryRunResult(null);
      setDryRunError(null);
      return;
    }
    let active = true;
    getRecentUploads(50).then(result => {
      if (!active) return;
      const matching = result.uploads
        .filter(upload => upload.FileDefinitionId === selectedDefinitionId &&
          ['VALIDATED', 'VALIDATION_PASSED', 'VALIDATION_FAILED', 'DELIVERED'].includes(upload.Status))
        .map(upload => ({
          Id: upload.Id,
          FileDefinitionId: upload.FileDefinitionId,
          OriginalFilename: upload.OriginalFilename,
          Status: upload.Status,
        }));
      setRecentUploads(matching);
      setSelectedDryRunUploadId(matching[0]?.Id ?? '');
    }).catch(error => {
      if (active) setDryRunError(error instanceof Error ? error.message : 'Could not load recent uploads.');
    });
    return () => { active = false; };
  }, [editingRule, isDrawerOpen, selectedDefinitionId]);
  //#endregion

  //#region DATA ACCESS OPERATIONS (API FETCHERS)
  const fetchDefinitions = async () => {
    try {
      setDefinitionsLoading(true);
      const data = await getFileDefinitions();
      if (data.definitions) {
        // Admins edit draft rules, so they target the draft's sheet tables; others see the published ones.
        const draftSettings = new Map<string, {
          sheets: string[];
          lookups: string[];
          summary: DefinitionSummary;
        }>();
        if (canManageRules) {
          const admin = await getFileDefinitionsAdmin().catch(() => null);
          for (const def of admin?.definitions ?? []) {
            const contract = (def as typeof def & { contract?: DefinitionContract }).contract;
            draftSettings.set(String(def.id).toLowerCase(), {
              sheets: contract?.layout === 'sheets'
                ? contract.tables.flatMap(table => table.sheet ? [table.sheet] : [])
                : (def.tables ?? []).map(table => table.sheet),
              lookups: Object.keys(contract?.lookups ?? {}),
              summary: mapDefinitionSummary(def as unknown as Record<string, unknown>),
            });
          }
        }
        const defs = data.definitions.map(def => {
          const draft = draftSettings.get(def.id.toLowerCase());
          return {
            ...(draft?.summary ?? def),
            sheets: draft?.sheets ?? def.tables.flatMap(table => table.sheet ? [table.sheet] : []),
            lookups: draft?.lookups ?? [],
          };
        });
        setDefinitions(defs);
        setSelectedDefinitionId(current => defs.some(definition => definition.id === current)
          ? current
          : defs[0]?.id ?? '');
      }
    } catch (err) {
      console.error('Error fetching definitions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load definitions');
    } finally {
      setDefinitionsLoading(false);
    }
  };

  const fetchRules = async (fileDefinitionId: string) => {
    try {
      setLoading(true);
      setError(null);
      const baseUrl = apiConfig.getBaseUrl();
      const response = await fetch(`${baseUrl}/rules/definitions/${fileDefinitionId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 403) throw new Error('Access denied to this file definition');
        throw new Error(errorData.message || 'Failed to fetch rules');
      }

      const data = await response.json();
      if (data.success && data.rules) {
        const mappedRules = data.rules.map((config: RuleConfig) => {
          const params = config.params as Record<string, unknown>;
          const request = typeof params.request === 'string' ? params.request : null;
          const explanation = typeof params.explanation === 'string' ? params.explanation : null;
          return {
            id: config.id,
            fileDefinitionId,
            name: config.name,
            description: config.description,
            executionOrder: config.executionOrder,
            ruleType: ruleConfigTypeLabel(config),
            severity: config.severity,
            sqlQuery: ruleConfigExpression(config),
            isEnabled: config.enabled,
            tableName: config.table,
            naturalLanguageText: request,
            config,
            explanation,
          };
        });
        setRules(mappedRules);
        setPublishedVersion(data.published ? data.versionNumber ?? null : null);
        setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      }
    } catch (err) {
      console.error('Error fetching rules:', err);
      setError(err instanceof Error ? err.message : 'Failed to load rules');
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const baseUrl = apiConfig.getBaseUrl();
      const method = editingRule ? 'PUT' : 'POST';
      const url = editingRule ? `${baseUrl}/rules/${editingRule.id}` : `${baseUrl}/rules`;
      const form = {
        id: editingRule?.config.id ?? crypto.randomUUID(),
        name: formData.name,
        description: formData.description,
        executionOrder: parseInt(formData.executionOrder) || 1,
        severity: formData.severity as 'Error' | 'Warning',
        enabled: formData.isEnabled,
        ruleType: formData.ruleType,
        params: formData.params,
        table: selectedSheets.length > 0 ? formData.tableName || null : null,
      };
      const config = editingRule
        ? updateRuleConfigFromForm(editingRule.config, form)
        : ruleConfigFromForm(form);
      const validation = await validateRuleConfig(baseUrl, token, selectedDefinitionId, config);
      setRuleValidation(validation);
      if (!validation.ok) return;
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(editingRule
          ? { Config: config }
          : { FileDefinitionId: selectedDefinitionId, Config: config })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const firstFieldError = errorData.errors?.[0];
        throw new Error(errorData.message || (firstFieldError ? `${firstFieldError.path || firstFieldError.param}: ${firstFieldError.msg}` : 'Failed to save rule'));
      }

      const data = await response.json();
      if (data.success) {
        setError(null);
        setIsDrawerOpen(false);
        fetchRules(selectedDefinitionId);
      }
    } catch (err) {
      console.error('Error saving rule:', err);
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    }
  };

  const handleNaturalLanguageRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generatingRule || !selectedDefinitionId) return;
    const controller = new AbortController();
    reviewAbort.current = controller;
    const startedAt = Date.now();
    setGeneratingRule(true);
    setReviewStartedAt(startedAt);
    setNow(startedAt);
    setError(null);
    setGenerationResult(null);
    setActivity([{ level: 'info', message: 'Sending the rule to the server', elapsedMs: 0 }]);
    try {
      const data = await reviewNaturalLanguageRule({
        baseUrl: apiConfig.getBaseUrl(),
        token,
        fileDefinitionId: selectedDefinitionId,
        request: naturalLanguageRequest.trim(),
        signal: controller.signal,
        onActivity: entry => setActivity(previous => [...previous, entry]),
      });
      if (data.outcome === 'mapped') {
        setGenerationResult({ outcome: 'mapped', reason: data.reason, config: data.config });
        await fetchRules(selectedDefinitionId);
      } else if (data.outcome === 'natural_language') {
        setGenerationResult({ outcome: 'natural_language', reason: data.reason, config: data.config });
        await fetchRules(selectedDefinitionId);
      } else {
        setGenerationResult({ outcome: 'rejected', reason: data.reason });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setActivity(previous => [...previous, { level: 'warning', message: 'You stopped the review', elapsedMs: Date.now() - startedAt }]);
        // The server may have saved the rule just before it saw the stop.
        void fetchRules(selectedDefinitionId);
      } else {
        const message = err instanceof Error ? err.message : 'Could not review the rule';
        setError(`Could not create the rule: ${message}`);
        setActivity(previous => previous.some(entry => entry.level === 'error' && entry.message === message)
          ? previous
          : [...previous, { level: 'error', message, elapsedMs: Date.now() - startedAt }]);
      }
    } finally {
      if (reviewAbort.current === controller) reviewAbort.current = null;
      setGeneratingRule(false);
    }
  };

  const handleRegenerateRule = async () => {
    if (generatingRule || !editingRule || !naturalLanguageRequest.trim()) return;
    const controller = new AbortController();
    reviewAbort.current = controller;
    const startedAt = Date.now();
    setGeneratingRule(true);
    setReviewStartedAt(startedAt);
    setNow(startedAt);
    setError(null);
    setGenerationResult(null);
    setActivity([{ level: 'info', message: 'Sending the revised rule to the server', elapsedMs: 0 }]);
    try {
      const data = await regenerateNaturalLanguageRule({
        baseUrl: apiConfig.getBaseUrl(),
        token,
        ruleId: editingRule.id,
        request: naturalLanguageRequest.trim(),
        signal: controller.signal,
        onActivity: entry => setActivity(previous => [...previous, entry]),
      });
      if (data.outcome === 'rejected') {
        setGenerationResult(data);
        return;
      }
      await fetchRules(selectedDefinitionId);
      setIsDrawerOpen(false);
      setEditingRule(null);
    } catch (err) {
      if (controller.signal.aborted) {
        setActivity(previous => [...previous, { level: 'warning', message: 'You stopped the regeneration', elapsedMs: Date.now() - startedAt }]);
        void fetchRules(selectedDefinitionId);
      } else {
        const message = err instanceof Error ? err.message : 'Could not regenerate the rule';
        setError(`Could not regenerate the rule: ${message}`);
        setActivity(previous => previous.some(entry => entry.level === 'error' && entry.message === message)
          ? previous
          : [...previous, { level: 'error', message, elapsedMs: Date.now() - startedAt }]);
      }
    } finally {
      if (reviewAbort.current === controller) reviewAbort.current = null;
      setGeneratingRule(false);
    }
  };

  const stopNaturalLanguageRule = () => reviewAbort.current?.abort();

  const updateNaturalLanguageExamples = (examples: NaturalLanguageExample[]) => {
    setFormData(previous => ({ ...previous, params: { ...previous.params, examples } }));
    setExampleTest(null);
  };

  const runNaturalLanguageExamples = async () => {
    if (!editingRule || editingRule.config.type !== 'naturalLanguage') return;
    setTestingExamples(true);
    setExampleTest(null);
    setError(null);
    try {
      const form = {
        id: editingRule.config.id,
        name: formData.name,
        description: formData.description,
        executionOrder: Number.parseInt(formData.executionOrder, 10) || 0,
        severity: formData.severity as 'Error' | 'Warning',
        enabled: formData.isEnabled,
        ruleType: 'naturalLanguage' as const,
        params: formData.params,
        table: selectedSheets.length > 0 ? formData.tableName || null : null,
      };
      const config = updateRuleConfigFromForm(editingRule.config, form);
      const result = await testNaturalLanguageRuleExamples(
        apiConfig.getBaseUrl(),
        token,
        selectedDefinitionId,
        config,
        naturalLanguageExamples(formData.params),
      );
      setExampleTest(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not run rule examples.');
    } finally {
      setTestingExamples(false);
    }
  };

  const runSelectedUploadDryRun = async () => {
    if (!selectedDryRunUploadId) return;
    setRunningDryRun(true);
    setDryRunResult(null);
    setDryRunError(null);
    try {
      setDryRunResult(await runUploadDryRun(apiConfig.getBaseUrl(), token, selectedDryRunUploadId));
    } catch (error) {
      setDryRunError(error instanceof Error ? error.message : 'Could not run validation preview.');
    } finally {
      setRunningDryRun(false);
    }
  };

  const editNaturalLanguageConfig = (config: RuleConfig) => {
    if (config.type !== 'naturalLanguage') return;
    const params = config.params as Record<string, unknown>;
    setEditingRule({
      id: config.id,
      fileDefinitionId: selectedDefinitionId,
      name: config.name,
      description: config.description,
      executionOrder: config.executionOrder,
      ruleType: ruleConfigTypeLabel(config),
      severity: config.severity,
      sqlQuery: ruleConfigExpression(config),
      isEnabled: config.enabled,
      tableName: config.table,
      naturalLanguageText: typeof params.request === 'string' ? params.request : null,
      explanation: typeof params.explanation === 'string' ? params.explanation : null,
      config,
    });
    setGenerationResult(null);
  };

  const startAnotherRule = () => {
    setNaturalLanguageRequest('');
    setGenerationResult(null);
    setActivity([]);
    setError(null);
  };

  const handleDelete = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    try {
      const baseUrl = apiConfig.getBaseUrl();
      const response = await fetch(`${baseUrl}/rules/${ruleId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete rule');
      }

      fetchRules(selectedDefinitionId);
    } catch (err) {
      console.error('Error deleting rule:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    } finally {
      setActiveMenuId(null);
    }
  };

  const handleToggle = async (rule: Rule) => {
    try {
      const baseUrl = apiConfig.getBaseUrl();
      const response = await fetch(`${baseUrl}/rules/${rule.id}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to toggle rule');
      }

      fetchRules(selectedDefinitionId);
    } catch (err) {
      console.error('Error toggling rule:', err);
      setError(err instanceof Error ? err.message : 'Failed to toggle rule');
    }
  };

  const handleClone = (rule: Rule) => {
    setEditingRule(null);
    setFormData({
      name: `${rule.name} - Copy`,
      executionOrder: (rule.executionOrder + 1).toString(),
      description: rule.description || '',
      ruleType: rule.config.type === 'naturalLanguage' ? DEFAULT_RULE_TYPE : rule.config.type,
      severity: rule.severity || 'Error',
      isEnabled: rule.isEnabled,
      tableName: rule.tableName || '',
      params: rule.config.type === 'naturalLanguage'
        ? defaultRuleParams(DEFAULT_RULE_TYPE)
        : { ...rule.config.params },
    });
    setIsDrawerOpen(true);
    setActiveMenuId(null);
  };
  //#endregion

  //#region DYNAMIC CLIENT FILTERING & AGGREGATIONS
  const filteredRules = rules.filter(rule => {
    const matchesSearch = rule.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (rule.description && rule.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          (rule.sqlQuery && rule.sqlQuery.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (severityFilter === 'ALL') return matchesSearch;
    return matchesSearch && rule.severity.toUpperCase() === severityFilter;
  });

  const activeCount = rules.filter(r => r.isEnabled).length;
  const warningCount = rules.filter(r => r.severity.toUpperCase() === 'WARNING' || r.severity.toUpperCase() === 'WARN').length;
  //#endregion

  //#region UTILITY RENDERING ASSISTS
  const getRuleIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'type check':
      case 'range check':
        return { icon: Database, bg: "bg-blue-50 text-blue-600" };
      case 'enum check':
        return { icon: ({ className }: any) => <span className={`font-bold text-sm ${className}`}>Aa</span>, bg: "bg-purple-50 text-purple-600" };
      case 'natural language':
        return { icon: Sparkles, bg: "bg-violet-50 text-violet-600" };
      default: return { icon: LayoutGrid, bg: "bg-amber-50 text-amber-600" };
    }
  };
  //#endregion

  if (definitionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
          <p className="text-sm font-medium text-slate-500">Loading system layout data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans antialiased text-slate-800">
      <div className="max-w-[1600px] mx-auto flex gap-6">
        
        {/* ========================================================================= */}
        {/* MAIN DASHBOARD FRAME (LEFT WORKSPACE)                                     */}
        {/* ========================================================================= */}
        <div className="flex-1 space-y-6">
          
          {/* Header Row */}
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-lg text-white">
                  <Settings className="w-6 h-6" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Validation Rules</h1>
              </div>
              <p className="text-slate-500 mt-1">
                {canManageRules
                  ? 'Manage quality and compliance rules for data integrity platforms.'
                  : 'View the quality and compliance rules applied to your uploads. Contact an admin to request changes.'}
              </p>
            </div>
            {canManageRules && (
              <button 
                onClick={() => { setEditingRule(null); setIsDrawerOpen(true); }}
                disabled={!selectedDefinitionId}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium px-4 py-2.5 rounded-lg shadow-sm transition-colors text-sm"
              >
                <Plus className="w-4 h-4" /> New Rule
              </button>
            )}
          </div>

          {/* Operational Standard Notification Banner */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex justify-between items-center text-red-800 text-sm shadow-sm animate-fadeIn">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <span>{error}</span>
              </div>
              <button onClick={() => setError(null)} className="text-xs font-bold underline ml-4 hover:text-red-950">Dismiss</button>
            </div>
          )}

          {selectedDefinition && (
            <DefinitionContextCard
              definition={selectedDefinition}
              showDraftState={canManageRules}
              actions={canManageRules ? (
                <Link
                  to={`/admin/file-definitions?definitionId=${encodeURIComponent(selectedDefinition.id)}&view=versions`}
                  className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Review changes &amp; publish
                </Link>
              ) : undefined}
            />
          )}

          {selectedDefinitionId && (
            <p role="note" className="text-sm text-slate-600">
              {canManageRules
                ? 'Rule changes are saved to the draft. New uploads keep using the published version until you publish.'
                : publishedVersion
                  ? `These are the rules in published version v${publishedVersion}.`
                  : 'These rules are applied to new uploads.'}
            </p>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-center justify-between gap-6">
            <div className="w-1/4">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Upload Definition</label>
              <div className="relative">
                <select 
                  disabled={generatingRule}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
                  value={selectedDefinitionId}
                  onChange={(e) => handleDefinitionChange(e.target.value)}
                >
                  {definitions.length === 0 ? (
                    <option value="">No definitions available</option>
                  ) : (
                    definitions.map((def) => (
                      <option key={def.id} value={def.id}>{def.name}</option>
                    ))
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-start gap-12 pl-6 border-l border-slate-100">
              <div>
                <div className="text-2xl font-bold text-slate-900">{activeCount}</div>
                <div className="text-xs font-medium text-emerald-600 mt-0.5">Active Rules</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">{warningCount}</div>
                <div className="text-xs font-medium text-amber-600 mt-0.5">Warnings Rules</div>
              </div>
              <div className="ml-auto flex items-center gap-2 text-slate-400">
                <button 
                  onClick={() => selectedDefinitionId && fetchRules(selectedDefinitionId)} 
                  className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors"
                  title="Reload rules data"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Last Sync</div>
                  <div className="text-sm font-medium text-slate-600">{lastUpdated}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Filtering Control Bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1 max-w-md bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 transition-all">
              <Search className="w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search rules by context or criteria..." 
                className="w-full text-sm outline-none bg-transparent text-slate-700"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && <X className="w-4 h-4 text-slate-400 cursor-pointer" onClick={() => setSearchTerm('')} />}
            </div>

            <div className="flex items-center gap-2">
              <div className="bg-slate-100 p-0.5 rounded-lg flex border border-slate-200 text-sm font-medium">
                {(['ALL', 'ERROR', 'WARNING'] as const).map((filterOpt) => (
                  <button
                    key={filterOpt}
                    onClick={() => setSeverityFilter(filterOpt)}
                    className={`px-3 py-1.5 rounded-md capitalize transition-all ${
                      severityFilter === filterOpt 
                        ? 'bg-white text-blue-600 shadow-xs font-semibold' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {filterOpt.toLowerCase()}
                  </button>
                ))}
              </div>

              {/* <button className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 shadow-sm">
                <SlidersHorizontal className="w-4 h-4" /> Advanced
              </button> */}
            </div>
          </div>

          {/* Interactive Rules Execution Layout Block */}
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-sm overflow-hidden">
            {loading && rules.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">Querying isolated active datasets...</div>
            ) : filteredRules.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">No rules match the selected file.</div>
            ) : (
              filteredRules.map((rule) => {
                const iconMeta = getRuleIcon(rule.ruleType);
                return (
                  <div key={rule.id} className={`p-5 transition-colors relative ${!rule.isEnabled ? 'bg-slate-50/50 opacity-75' : 'hover:bg-slate-50/20'}`}>
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-xl flex items-center justify-center w-12 h-12 shrink-0 ${iconMeta.bg}`}>
                        <iconMeta.icon className="w-5 h-5" />
                      </div>
                      
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-slate-900">{rule.name}</h3>
                            {(rule.tableName || ruleConfigColumns(rule.config).includes(':')) && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200" title="Sheet table">
                                {rule.tableName
                                  ? `Sheet: ${rule.tableName}`
                                  : `Tables: ${ruleConfigColumns(rule.config).split(' | ').map(entry => entry.split(':')[0]).join(', ')}`}
                              </span>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                              rule.severity?.toUpperCase() === 'ERROR' 
                                ? 'bg-red-50 text-red-600 border-red-100' 
                                : 'bg-amber-50 text-amber-700 border-amber-100'
                            }`}>{rule.severity}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                              rule.isEnabled 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}>
                              {rule.isEnabled ? 'ACTIVE' : 'DISABLED'}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">• Order #{rule.executionOrder}</span>
                          </div>
                          <div className="flex items-center gap-4 relative">
                            {rule.creatorName && <span className="text-xs text-slate-400">By {rule.creatorName}</span>}
                            {canManageRules && (
                            <button 
                              onClick={() => setActiveMenuId(activeMenuId === rule.id ? null : rule.id)}
                              className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            )}

                            {/* Dropdown Action Controls Block */}
                            {canManageRules && activeMenuId === rule.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setActiveMenuId(null)} />
                                <div className="absolute right-0 top-7 w-40 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 text-xs font-medium">
                                  <button onClick={() => { setEditingRule(rule); setIsDrawerOpen(true); setActiveMenuId(null); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700">
                                    <Edit2 className="w-3.5 h-3.5 text-slate-400" /> Edit Configuration
                                  </button>
                                  {!isGeneratedRule(rule) && (
                                  <button onClick={() => handleClone(rule)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700">
                                    <Copy className="w-3.5 h-3.5 text-slate-400" /> Clone Logic
                                  </button>
                                  )}
                                  <button onClick={() => handleDelete(rule.id)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-red-600 font-semibold border-t border-slate-100">
                                    <Trash2 className="w-3.5 h-3.5 text-red-400" /> Purge Rule
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {rule.description && !isGeneratedRule(rule) && <p className="text-xs text-slate-500 max-w-3xl line-clamp-2">{rule.description}</p>}
                        <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide">{rule.ruleType}</div>
                        
                        {isGeneratedRule(rule) ? (
                          <>
                            {ruleConfigColumns(rule.config) && <p className="text-xs text-slate-500">Columns read: <span className="font-mono">{ruleConfigColumns(rule.config)}</span></p>}
                            <RuleConfigDetails
                              naturalLanguageText={rule.naturalLanguageText}
                              explanation={rule.explanation}
                              expression={rule.sqlQuery}
                              provenance={rule.config.params.provenance}
                              examples={rule.config.params.examples}
                            />
                          </>
                        ) : rule.sqlQuery && (
                          <div className="bg-slate-900 border border-slate-950 rounded-lg p-3 font-mono text-xs text-emerald-400 max-w-3xl overflow-x-auto shadow-inner">
                            {rule.sqlQuery}
                          </div>
                        )}

                        {/* Direct Control Actions Inline */}
                        {canManageRules && (
                        <div className="flex items-center gap-4 pt-1 text-xs font-semibold">
                          <button onClick={() => { setEditingRule(rule); setIsDrawerOpen(true); }} className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700">
                            <Edit2 className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button onClick={() => handleToggle(rule)} className={`flex items-center gap-1.5 transition-colors ${rule.isEnabled ? 'text-slate-500 hover:text-slate-600' : 'text-emerald-600 hover:text-emerald-700'}`}>
                            <Power className="w-3.5 h-3.5" /> {rule.isEnabled ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* VALIDATION RULE CREATOR & EDITOR DRAWER (RIGHT PANEL)                    */}
        {/* ========================================================================= */}
        {canManageRules && isDrawerOpen && (
          <div className="w-[450px] bg-white border border-slate-200 rounded-2xl shadow-lg flex flex-col overflow-hidden self-start sticky top-8 animate-slideLeft">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-blue-600">
                <Shield className="w-5 h-5" />
                <h2 className="font-bold text-lg text-slate-900">
                  {editingRule ? 'Edit Validation Rule' : 'New Validation Rule'}
                </h2>
              </div>
              <button onClick={() => setIsDrawerOpen(false)} disabled={generatingRule} className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-50 disabled:opacity-50">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Entry Field Framework */}
            <form onSubmit={formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule ? handleNaturalLanguageRule : handleSaveRule} className="flex flex-col flex-1 overflow-y-auto">
              <div className="p-6 space-y-5 flex-1">
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">
                    {error}
                  </div>
                )}
                {validatingRule && <p role="status" className="text-xs text-slate-500">Validating RuleConfig…</p>}
                {ruleValidationError && <p role="alert" className="text-xs text-red-700">{ruleValidationError}</p>}
                {ruleValidation?.errors.length ? (
                  <ul role="alert" className="space-y-1 rounded bg-amber-50 p-3 text-xs text-amber-900">
                    {ruleValidation.errors.map((item, index) => <li key={`${item.path}-${index}`}>{item.path}: {item.message}</li>)}
                  </ul>
                ) : ruleValidation?.ok ? (
                  <p role="status" className="text-xs text-emerald-700">RuleConfig is valid for this definition.</p>
                ) : null}
                <div>
                  <h3 className="font-bold text-sm text-slate-900">{formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule ? 'Describe your rule' : 'System Parameters'}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule
                      ? 'The model maps your request to a declarative rule or proposes restricted SQL validated by the Python service.'
                      : 'Configure a typed RuleConfig and validate it against the definition before saving.'}
                  </p>
                </div>

                {!editingRule && (
                  <div className="space-y-1.5">
                    <label htmlFor="ruleStrategy" className="text-xs font-bold text-slate-600">Rule type <span className="text-red-500">*</span></label>
                    <select
                      id="ruleStrategy"
                      value={formData.ruleType}
                      disabled={generatingRule}
                      onChange={e => {
                        const ruleType = e.target.value as RuleConfig['type'];
                        setFormData({ ...formData, ruleType, params: defaultRuleParams(ruleType) });
                        setGenerationResult(null);
                        setActivity([]);
                        setError(null);
                      }}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium"
                    >
                      {RULE_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                      <option value={NATURAL_LANGUAGE_STRATEGY}>Natural language</option>
                    </select>
                  </div>
                )}

                {formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">
                      Describe one check. The model prefers a matching built-in RuleConfig type; otherwise it proposes restricted SQL.
                      The Python service validates every proposal and runs its examples before the rule is saved to the draft.
                    </p>
                    <label htmlFor="naturalLanguageRule" className="block text-xs font-bold text-slate-600">Rule to enforce <span className="text-red-500">*</span></label>
                    <textarea
                      id="naturalLanguageRule"
                      required
                      maxLength={1000}
                      rows={4}
                      disabled={generatingRule || ruleCreated}
                      value={naturalLanguageRequest}
                      onChange={e => { setNaturalLanguageRequest(e.target.value); setGenerationResult(null); }}
                      placeholder="For example: The Amount column must be between 0 and 100"
                      className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                    />
                    <RuleReviewActivity entries={activity} running={generatingRule} elapsedMs={reviewStartedAt ? now - reviewStartedAt : 0} />
                    {generationResult?.outcome === 'rejected' && (
                      <p role="status" className="text-sm text-amber-800 bg-amber-50 p-3 rounded-lg">Cannot create rule: {generationResult.reason}</p>
                    )}
                    {generationResult?.outcome === 'mapped' && (
                      <div role="status" className="space-y-2">
                        <p className="text-sm text-emerald-700 font-medium">
                          Created draft rule "{generationResult.config.name}" as {ruleConfigTypeLabel(generationResult.config)}: <code>{ruleConfigExpression(generationResult.config)}</code>
                        </p>
                        <p className="text-xs text-slate-500">{generationResult.reason}</p>
                      </div>
                    )}
                    {generationResult?.outcome === 'natural_language' && (
                      <div role="status" className="space-y-2">
                        <p className="text-sm text-emerald-700 font-medium">Created draft Natural Language rule "{generationResult.config.name}"</p>
                        <p className="text-xs text-slate-500">{generationResult.reason} Review the validated rule expression and examples before publishing.</p>
                        <RuleConfigDetails
                          naturalLanguageText={naturalLanguageRequest}
                          explanation={typeof generationResult.config.params.explanation === 'string' ? generationResult.config.params.explanation : null}
                          expression={ruleConfigExpression(generationResult.config)}
                          provenance={generationResult.config.params.provenance}
                          examples={generationResult.config.params.examples}
                          expanded
                        />
                        <button
                          type="button"
                          onClick={() => editNaturalLanguageConfig(generationResult.config)}
                          className="rounded border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                        >
                          Review and edit examples
                        </button>
                      </div>
                    )}
                    {ruleCreated && (
                      <p className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <span className="font-semibold">Next step:</span> the rule is saved to the draft. Uploads use it after you publish a new version in{' '}
                        <Link to="/admin/file-definitions" className="font-semibold underline">File Definitions → Versions</Link>.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                {/* Field: Rule Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600">Rule Name <span className="text-red-500">*</span></label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g., Amount Cannot Be Negative"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 shadow-xs"
                  />
                </div>

                {/* Field: Description Context */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600">Description</label>
                  <textarea 
                    rows={2}
                    placeholder="Provide functional context regarding schema or operational parameters checked..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 resize-none shadow-xs"
                  />
                </div>

                {/* Execution Severity & Array Priority Group */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600">Severity Level <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <select 
                        value={formData.severity}
                        onChange={(e) => setFormData({ ...formData, severity: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium shadow-xs"
                      >
                        <option value="Error">🔴 Error</option>
                        <option value="Warning">🟡 Warning</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600">Execution Order <span className="text-red-500">*</span></label>
                    <input 
                      type="number" 
                      required
                      min="1"
                      value={formData.executionOrder}
                      onChange={(e) => setFormData({ ...formData, executionOrder: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 font-medium shadow-xs"
                    />
                  </div>
                </div>

                {/* Field: Sheet table (definitions with one table per workbook sheet) */}
                {selectedSheets.length > 0 && !isGeneratedRule(editingRule) && formData.ruleType !== 'reconcile' && (
                  <div className="space-y-1.5">
                    <label htmlFor="ruleTable" className="text-xs font-bold text-slate-600">Sheet Table <span className="text-red-500">*</span></label>
                    <p className="text-[11px] text-slate-500">The rule checks rows of this workbook sheet only.</p>
                    <select
                      id="ruleTable"
                      required
                      value={formData.tableName}
                      onChange={(e) => setFormData({ ...formData, tableName: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium shadow-xs"
                    >
                      <option value="">Choose a sheet...</option>
                      {formData.tableName && !selectedSheets.some(sheet => sheet.toLowerCase() === formData.tableName.toLowerCase()) && (
                        <option value={formData.tableName}>{formData.tableName} (no longer defined)</option>
                      )}
                      {selectedSheets.map(sheet => (
                        <option key={sheet} value={sheet}>{sheet}</option>
                      ))}
                    </select>
                  </div>
                )}

                {isGeneratedRule(editingRule) ? (
                  <div className="space-y-3 border-t border-slate-100 pt-4">
                    <p className="text-xs font-bold text-slate-600">Natural Language rule</p>
                    <p className="text-[11px] text-slate-500">
                      {editingRule!.tableName
                        ? `Sheet ${editingRule!.tableName}. `
                        : ''}
                      Columns read: <span className="font-mono">{ruleConfigColumns(editingRule!.config)}</span>.
                      Edit the original request and regenerate to change what the rule checks. The current rule remains unchanged if regeneration fails or is stopped.
                    </p>
                    <label htmlFor="regenerateNaturalLanguageRule" className="block text-xs font-bold text-slate-600">Original request <span className="text-red-500">*</span></label>
                    <textarea
                      id="regenerateNaturalLanguageRule"
                      required
                      maxLength={1000}
                      rows={4}
                      disabled={generatingRule}
                      value={naturalLanguageRequest}
                      onChange={e => { setNaturalLanguageRequest(e.target.value); setGenerationResult(null); }}
                      className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                    />
                    <button
                      type="button"
                      disabled={generatingRule || !naturalLanguageRequest.trim() || naturalLanguageRequest.trim() === (editingRule!.naturalLanguageText ?? editingRule!.description ?? '').trim()}
                      onClick={handleRegenerateRule}
                      className="w-full flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm"
                    >
                      <Sparkles className="w-4 h-4" />
                      {generatingRule
                        ? `Regenerating rule… ${reviewStartedAt ? Math.floor((now - reviewStartedAt) / 1000) : 0} s`
                        : 'Regenerate from request'}
                    </button>
                    <RuleReviewActivity entries={activity} running={generatingRule} elapsedMs={reviewStartedAt ? now - reviewStartedAt : 0} />
                    {generationResult?.outcome === 'rejected' && (
                      <p role="status" className="text-sm text-amber-800 bg-amber-50 p-3 rounded-lg">Cannot regenerate rule: {generationResult.reason}</p>
                    )}
                    <RuleConfigDetails
                      naturalLanguageText={editingRule!.naturalLanguageText}
                      explanation={editingRule!.explanation}
                      expression={editingRule!.sqlQuery}
                      provenance={editingRule!.config.params.provenance}
                      examples={editingRule!.config.params.examples}
                    />
                    <NaturalLanguageExamplesEditor
                      examples={naturalLanguageExamples(formData.params)}
                      tableOptions={selectedSheets}
                      results={exampleTest?.results ?? null}
                      running={testingExamples}
                      onChange={updateNaturalLanguageExamples}
                      onRun={() => void runNaturalLanguageExamples()}
                    />
                    {exampleTest && exampleTest.errors.length > 0 && (
                      <ul role="alert" className="space-y-1 rounded bg-red-50 p-3 text-xs text-red-700">
                        {exampleTest.errors.map((item, index) => <li key={`${item.path}-${index}`}>{item.path}: {item.message}</li>)}
                      </ul>
                    )}
                    <section className="space-y-2 border-t border-slate-100 pt-4" aria-label="Dry run">
                      <div>
                        <p className="text-xs font-bold text-slate-600">Dry run against a recent upload</p>
                        <p className="text-[11px] text-slate-500">Preview the current draft contract on an upload for this definition. Cell values are not shown here.</p>
                      </div>
                      {recentUploads.length > 0 ? (
                        <div className="flex gap-2">
                          <select
                            aria-label="Recent upload for dry run"
                            value={selectedDryRunUploadId}
                            onChange={event => setSelectedDryRunUploadId(event.target.value)}
                            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-2 text-xs"
                          >
                            {recentUploads.map(upload => (
                              <option key={upload.Id} value={upload.Id}>{upload.OriginalFilename} — {upload.Status}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={runningDryRun || !selectedDryRunUploadId}
                            onClick={() => void runSelectedUploadDryRun()}
                            className="rounded bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {runningDryRun ? 'Running…' : 'Dry run'}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No completed uploads are available for this definition.</p>
                      )}
                      {dryRunError && <p role="alert" className="text-xs text-red-700">{dryRunError}</p>}
                      {dryRunResult && (
                        <div role="status" className="rounded bg-slate-50 p-3 text-xs text-slate-700">
                          <p className="font-semibold">Preview status: {String(dryRunResult.status ?? 'unknown')}</p>
                          <p>{Array.isArray(dryRunResult.structuralIssues) ? dryRunResult.structuralIssues.length : 0} structural issue(s)</p>
                          {Array.isArray(dryRunResult.checks) && (
                            <ul className="mt-2 space-y-1">
                              {dryRunResult.checks.map((item, index) => {
                                if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
                                const check = item as Record<string, unknown>;
                                return (
                                  <li key={String(check.id ?? index)}>
                                    {String(check.name ?? 'Check')}: {String(check.status ?? 'unknown')}
                                    {typeof check.issueCount === 'number' ? ` (${check.issueCount} issue(s))` : ''}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}
                    </section>
                  </div>
                ) : (
                  <>
                {editingRule && (
                  <div className="space-y-1.5">
                    <label htmlFor="editRuleStrategy" className="text-xs font-bold text-slate-600">Rule type <span className="text-red-500">*</span></label>
                    <select
                      id="editRuleStrategy"
                      value={formData.ruleType}
                      onChange={e => {
                        const ruleType = e.target.value as RuleConfig['type'];
                        setFormData({ ...formData, ruleType, params: defaultRuleParams(ruleType) });
                      }}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium"
                    >
                      {RULE_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                    </select>
                  </div>
                )}

                <RuleConfigFields
                  type={formData.ruleType as Exclude<RuleConfig['type'], 'naturalLanguage'>}
                  params={formData.params}
                  lookupIds={selectedLookupIds}
                  onChange={params => setFormData(previous => ({ ...previous, params }))}
                />
                  </>
                )}
                  </>
                )}

                {/* Field: Status Toggle Checkbox */}
                {/* <div className="flex items-center gap-2.5 pt-1">
                  <input 
                    type="checkbox" 
                    id="isEnabledDrawer" 
                    checked={formData.isEnabled}
                    onChange={(e) => setFormData({ ...formData, isEnabled: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="isEnabledDrawer" className="text-xs font-bold text-slate-700 select-none cursor-pointer">
                    Enable for Production Pipelines Immediately
                  </label>
                </div> */}

                {/* Callout Info Banner */}
                {/* <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2.5 text-xs text-blue-700 font-medium">
                  <Info className="w-4 h-4 shrink-0 text-blue-500 mt-0.5" />
                  <p>Rules run asynchronously in ascending sequence order. Intercept structures run priority metrics first.</p>
                </div> */}
              </div>

              {/* Sidebar Action Footer Controls */}
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center shrink-0">
                {ruleCreated ? (
                  <>
                    <button
                      type="button"
                      onClick={startAnotherRule}
                      className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      Create another rule
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsDrawerOpen(false)}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm shadow-sm"
                    >
                      Done <Check className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                <button 
                  type="button"
                  onClick={generatingRule ? stopNaturalLanguageRule : () => setIsDrawerOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  {generatingRule ? 'Stop' : 'Cancel'}
                </button>
                <button 
                  type="submit"
                  disabled={generatingRule || (formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule && !naturalLanguageRequest.trim())}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm shadow-sm"
                >
                  {generatingRule
                    ? `Reviewing rule… ${reviewStartedAt ? Math.floor((now - reviewStartedAt) / 1000) : 0} s`
                    : formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule ? 'Review and create rule' : editingRule ? 'Update Rule' : 'Save Validation Rule'} <ChevronRight className="w-4 h-4" />
                </button>
                  </>
                )}
              </div>
            </form>

          </div>
        )}

      </div>
    </div>
  );
}
