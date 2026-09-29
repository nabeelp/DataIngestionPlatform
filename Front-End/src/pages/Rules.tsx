import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Search, SlidersHorizontal, MoreVertical, Edit2, 
  Copy, Power, Shield, Database, LayoutGrid, AlertTriangle, 
  RefreshCw, Info, ChevronRight, X, Trash2, Settings, Sparkles, Check,
} from 'lucide-react';
import { apiConfig } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { getFileDefinitionsAdmin } from '../services/adminApi';
import { reviewNaturalLanguageRule, type ReviewActivity } from '../services/ruleAuthoringApi';
import GeneratedRuleDetails from './GeneratedRuleDetails';
import RuleReviewActivity from './RuleReviewActivity';

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
  pseudocode?: string | null;
  generatedCode?: string | null;
}

type GenerationResult =
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'mapped'; reason: string; name: string; ruleType: string; expression: string; pseudocode: string }
  | { outcome: 'natural_language'; reason: string; name: string; pseudocode: string; typescript: string; naturalLanguageText: string };

interface Definition {
  id: string;
  name: string;
  /** Sheet tables rules can target (empty for single-table definitions). */
  sheets: string[];
}

interface FormState {
  name: string;
  executionOrder: string;
  description: string;
  ruleType: string;
  severity: string;
  sqlQuery: string;
  isEnabled: boolean;
  tableName: string;
}
//#endregion

const RULE_TYPES = [
  { value: 'Schema Validation', label: 'Required columns', help: 'Comma-separated columns that must exist in the file header.', example: 'CustomerId, Email, Country' },
  { value: 'Required Values', label: 'Required values', help: 'Comma-separated columns whose values must not be empty.', example: 'CustomerId, Email' },
  { value: 'Type Check', label: 'Data type', help: 'Column and type: string, integer, decimal, datetime, or boolean.', example: 'UnitPrice: decimal' },
  { value: 'Enum Check', label: 'Allowed values', help: 'Column followed by the comma-separated allowed values.', example: 'CustomerStatus: Active, Inactive' },
  { value: 'Range Check', label: 'Numeric range', help: 'Column and inclusive range "min..max"; either bound may be omitted.', example: 'StockQuantity: 0..10000' },
];
const DEFAULT_RULE_TYPE = RULE_TYPES[0].value;
// Also the stored rule type of rules generated from a request that no declarative type expresses without loss.
const NATURAL_LANGUAGE_STRATEGY = 'Natural Language';
const isGeneratedRule = (rule: Pick<Rule, 'ruleType'> | null | undefined) => rule?.ruleType === NATURAL_LANGUAGE_STRATEGY;
const getRuleTypeMeta = (type: string) =>
  RULE_TYPES.find(t => t.value === type) || { value: type, label: type, help: 'This rule type is no longer supported. Choose a supported type.', example: '' };

export default function ValidationRules() {
  const { token, user } = useAuth();
  const canManageRules = user?.Role === 'admin';

  //#region STATE MANAGERS
  const [rules, setRules] = useState<Rule[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string>('');
  
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
    sqlQuery: '',
    isEnabled: true,
    tableName: ''
  });
  //#endregion

  const selectedSheets = definitions.find(def => def.id === selectedDefinitionId)?.sheets ?? [];
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
    setNaturalLanguageRequest('');
    setGenerationResult(null);
    setActivity([]);
    if (editingRule) {
      setFormData({
        name: editingRule.name || '',
        executionOrder: editingRule.executionOrder?.toString() || '8',
        description: editingRule.description || '',
        ruleType: editingRule.ruleType || DEFAULT_RULE_TYPE,
        severity: editingRule.severity || 'Error',
        sqlQuery: editingRule.sqlQuery || '',
        isEnabled: editingRule.isEnabled !== false,
        tableName: editingRule.tableName || ''
      });
    } else {
      setFormData({
        name: '',
        executionOrder: '8',
        description: '',
        ruleType: DEFAULT_RULE_TYPE,
        severity: 'Error',
        sqlQuery: '',
        isEnabled: true,
        tableName: ''
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
  //#endregion

  //#region DATA ACCESS OPERATIONS (API FETCHERS)
  const fetchDefinitions = async () => {
    try {
      setDefinitionsLoading(true);
      const baseUrl = apiConfig.getBaseUrl();
      const response = await fetch(`${baseUrl}/definitions`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to fetch definitions');

      const data = await response.json();
      if (data.success && data.definitions) {
        // Admins edit draft rules, so they target the draft's sheet tables; others see the published ones.
        const draftSheets = new Map<string, string[]>();
        if (canManageRules) {
          const admin = await getFileDefinitionsAdmin().catch(() => null);
          for (const def of admin?.definitions ?? []) {
            draftSheets.set(String(def.id).toLowerCase(), (def.tables ?? []).map(table => table.sheet));
          }
        }
        const defs = data.definitions.map((def: any) => {
          const id = def.Id || def.id;
          const publishedSheets = (def.Tables || def.tables || []).map((table: { sheet: string }) => table.sheet);
          return {
            id,
            name: def.Name || def.name,
            sheets: draftSheets.get(String(id).toLowerCase()) ?? publishedSheets,
          };
        });
        setDefinitions(defs);
        if (defs.length > 0 && !selectedDefinitionId) {
          setSelectedDefinitionId(defs[0].id);
        }
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
        const mappedRules = data.rules.map((rule: any) => ({
          id: rule.Id || rule.id,
          fileDefinitionId: rule.FileDefinitionId || rule.fileDefinitionId,
          name: rule.Name || rule.name,
          description: rule.Description || rule.description,
          executionOrder: rule.ExecutionOrder || rule.executionOrder,
          ruleType: rule.RuleType || rule.ruleType,
          severity: rule.Severity || rule.severity,
          sqlQuery: rule.SqlQuery || rule.sqlQuery,
          isEnabled: rule.IsEnabled !== undefined ? rule.IsEnabled : rule.isEnabled,
          tableName: rule.TableName ?? rule.tableName ?? null,
          createdBy: rule.CreatedBy || rule.createdBy,
          creatorName: rule.CreatorName || rule.creatorName,
          naturalLanguageText: rule.NaturalLanguageText ?? rule.naturalLanguageText ?? null,
          pseudocode: rule.Pseudocode ?? rule.pseudocode ?? null,
          generatedCode: rule.GeneratedCode ?? rule.generatedCode ?? null,
        }));
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
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(isGeneratedRule(editingRule)
          // The logic of a generated rule is fixed; only its presentation and ordering can change.
          ? {
            Name: formData.name,
            Description: formData.description,
            Severity: formData.severity,
            ExecutionOrder: parseInt(formData.executionOrder) || 1,
          }
          : {
            FileDefinitionId: selectedDefinitionId,
            Name: formData.name,
            Description: formData.description,
            RuleType: formData.ruleType,
            Severity: formData.severity,
            ExecutionOrder: parseInt(formData.executionOrder) || 1,
            SqlQuery: formData.sqlQuery,
            IsEnabled: formData.isEnabled,
            TableName: selectedSheets.length > 0 ? formData.tableName || null : null
          })
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
        setGenerationResult({
          outcome: 'mapped', reason: data.reason, name: data.rule.Name, ruleType: data.rule.RuleType,
          expression: data.rule.SqlQuery, pseudocode: data.pseudocode,
        });
        await fetchRules(selectedDefinitionId);
      } else if (data.outcome === 'natural_language') {
        setGenerationResult({
          outcome: 'natural_language', reason: data.reason, name: data.rule.Name, pseudocode: data.pseudocode,
          typescript: data.typescript, naturalLanguageText: data.rule.NaturalLanguageText ?? naturalLanguageRequest.trim(),
        });
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

  const stopNaturalLanguageRule = () => reviewAbort.current?.abort();

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
      ruleType: rule.ruleType || DEFAULT_RULE_TYPE,
      severity: rule.severity || 'Error',
      sqlQuery: rule.sqlQuery || '',
      isEnabled: rule.isEnabled,
      tableName: rule.tableName || ''
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

  const totalCount = rules.length;
  const activeCount = rules.filter(r => r.isEnabled).length;
  const errorCount = rules.filter(r => r.severity.toUpperCase() === 'ERROR').length;
  const warningCount = rules.filter(r => r.severity.toUpperCase() === 'WARNING' || r.severity.toUpperCase() === 'WARN').length;
  const disabledCount = totalCount - activeCount;
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

          {/* Upload Definition & Dynamic Aggregations Row */}
          {selectedDefinitionId && (
            <div role="note" className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-blue-900 text-sm">
              {canManageRules ? (
                <>
                  Rule changes are saved as a draft. Uploads keep using the active version until you publish a new version from{' '}
                  <Link to="/admin/file-definitions" className="font-semibold underline">File Definitions → Versions</Link>.
                </>
              ) : publishedVersion ? (
                `Showing the rules of published version v${publishedVersion}, which new uploads are validated against.`
              ) : (
                'Showing the rules currently applied to new uploads.'
              )}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-center justify-between gap-6">
            <div className="w-1/4">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Upload Definition</label>
              <div className="relative">
                <select 
                  disabled={generatingRule}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
                  value={selectedDefinitionId}
                  onChange={(e) => setSelectedDefinitionId(e.target.value)}
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

          {/* Core Analytics KPI Summary Block */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total Rules', count: totalCount, icon: Database, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Error Rules', count: errorCount, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
              { label: 'Warnings Rules', count: warningCount, icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50' },
              { label: 'Disabled Rules', count: disabledCount, icon: Power, color: 'text-slate-400', bg: 'bg-slate-100' },
            ].map((stat, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4 shadow-sm">
                <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500">{stat.label}</div>
                  <div className="text-2xl font-bold text-slate-900 mt-0.5">{stat.count}</div>
                </div>
              </div>
            ))}
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
                            {rule.tableName && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200" title="Sheet table">
                                Sheet: {rule.tableName}
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
                            {rule.sqlQuery && <p className="text-xs text-slate-500">Columns read: <span className="font-mono">{rule.sqlQuery}</span></p>}
                            <GeneratedRuleDetails naturalLanguageText={rule.naturalLanguageText} pseudocode={rule.pseudocode} generatedCode={rule.generatedCode} />
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

            {/* Configured Architecture Progress Stepper Component */}
            <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between text-xs font-semibold">
              <div className="flex flex-col items-center gap-1 flex-1">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-[11px]">1</div>
                <span className="text-blue-600">Parameters</span>
              </div>
              <div className="h-px bg-slate-200 flex-1 -mt-4"></div>
              <div className="flex flex-col items-center gap-1 flex-1">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-[11px]">2</div>
                <span className="text-blue-600">Engine Profile</span>
              </div>
            </div>

            {/* Form Entry Field Framework */}
            <form onSubmit={formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule ? handleNaturalLanguageRule : handleSaveRule} className="flex flex-col flex-1 overflow-y-auto">
              <div className="p-6 space-y-5 flex-1">
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">
                    {error}
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-sm text-slate-900">{formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule ? 'Describe your rule' : 'System Parameters'}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule
                      ? 'The model maps your rule to an existing rule type when nothing is lost, or otherwise generates code to enforce it.'
                      : 'Define runtime parameters mapped directly to active schemas.'}
                  </p>
                </div>

                {!editingRule && (
                  <div className="space-y-1.5">
                    <label htmlFor="ruleStrategy" className="text-xs font-bold text-slate-600">Evaluation Strategy <span className="text-red-500">*</span></label>
                    <select
                      id="ruleStrategy"
                      value={formData.ruleType}
                      disabled={generatingRule}
                      onChange={e => {
                        setFormData({ ...formData, ruleType: e.target.value });
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
                      Describe one check of the file's rows. When an existing rule type (required columns or values, data type,
                      allowed values, numeric range) expresses it exactly, that type is used. Otherwise a Natural Language rule is
                      created with generated pseudocode and TypeScript, verified against examples, and run in a sandbox during
                      validation. Rules are saved to the draft; review them and publish the definition version before they apply to uploads.
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
                          Created draft rule "{generationResult.name}" as {getRuleTypeMeta(generationResult.ruleType).label}: <code>{generationResult.expression}</code>
                        </p>
                        <p className="text-xs text-slate-500">{generationResult.reason}</p>
                        <p className="text-xs font-semibold text-slate-600">How this rule is evaluated (pseudocode)</p>
                        <pre className="bg-slate-900 text-emerald-400 p-3 rounded-lg text-xs whitespace-pre-wrap overflow-x-auto">{generationResult.pseudocode}</pre>
                      </div>
                    )}
                    {generationResult?.outcome === 'natural_language' && (
                      <div role="status" className="space-y-2">
                        <p className="text-sm text-emerald-700 font-medium">Created draft Natural Language rule "{generationResult.name}"</p>
                        <p className="text-xs text-slate-500">{generationResult.reason} Review the generated code before publishing.</p>
                        <GeneratedRuleDetails pseudocode={generationResult.pseudocode} generatedCode={generationResult.typescript} expanded />
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
                {selectedSheets.length > 0 && !isGeneratedRule(editingRule) && (
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
                  <div className="space-y-2 border-t border-slate-100 pt-4">
                    <p className="text-xs font-bold text-slate-600">Natural Language rule</p>
                    <p className="text-[11px] text-slate-500">
                      {editingRule!.tableName ? `Sheet ${editingRule!.tableName}. ` : ''}Columns read: <span className="font-mono">{editingRule!.sqlQuery}</span>.
                      The generated logic cannot be edited; create a new rule to change what it checks.
                    </p>
                    <GeneratedRuleDetails
                      naturalLanguageText={editingRule!.naturalLanguageText}
                      pseudocode={editingRule!.pseudocode}
                      generatedCode={editingRule!.generatedCode}
                    />
                  </div>
                ) : (
                  <>
                {editingRule && (
                  <div className="space-y-1.5">
                    <label htmlFor="editRuleStrategy" className="text-xs font-bold text-slate-600">Evaluation Strategy <span className="text-red-500">*</span></label>
                    <select
                      id="editRuleStrategy"
                      value={formData.ruleType}
                      onChange={e => setFormData({ ...formData, ruleType: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium"
                    >
                      {!RULE_TYPES.some(type => type.value === formData.ruleType) && (
                        <option value={formData.ruleType} disabled>{formData.ruleType} (no longer supported)</option>
                      )}
                      {RULE_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                    </select>
                  </div>
                )}

                {/* Field: Rule expression */}
                <div className="space-y-1.5">
                  <label htmlFor="ruleExpression" className="text-xs font-bold text-slate-600">Rule Expression <span className="text-red-500">*</span></label>
                  <p className="text-[11px] text-slate-500">{getRuleTypeMeta(formData.ruleType).help}</p>
                  <textarea 
                    id="ruleExpression"
                    required
                    rows={4}
                    maxLength={4000}
                    placeholder={getRuleTypeMeta(formData.ruleType).example}
                    value={formData.sqlQuery}
                    onChange={(e) => setFormData({ ...formData, sqlQuery: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-900 text-emerald-400 font-mono shadow-inner resize-y min-h-[100px]"
                  />
                </div>
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
                    : formData.ruleType === NATURAL_LANGUAGE_STRATEGY && !editingRule ? 'Review and create rule' : editingRule ? 'Update Parameters' : 'Save Validation Rule'} <ChevronRight className="w-4 h-4" />
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
