import React, { useState, useEffect } from 'react';
import { 
  Plus, Search, SlidersHorizontal, MoreVertical, Edit2, 
  Copy, Power, Shield, Database, LayoutGrid, AlertTriangle, 
  RefreshCw, Info, ChevronRight, X, Trash2, Settings,
} from 'lucide-react';
import { apiConfig } from '../config/api';
import { useAuth } from '../context/AuthContext';

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
  createdBy?: string | null;
  creatorName?: string;
}

interface Definition {
  id: string;
  name: string;
}

interface FormState {
  name: string;
  executionOrder: string;
  description: string;
  ruleType: string;
  severity: string;
  sqlQuery: string;
  isEnabled: boolean;
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
const getRuleTypeMeta = (type: string) =>
  RULE_TYPES.find(t => t.value === type) || { value: type, label: type, help: 'This rule type is no longer supported. Choose a supported type.', example: '' };

export default function ValidationRules() {
  const { token } = useAuth();

  //#region STATE MANAGERS
  const [rules, setRules] = useState<Rule[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string>('');
  
  // Loaders & Errors
  const [definitionsLoading, setDefinitionsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('Never');

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
    isEnabled: true
  });
  //#endregion

  //#region LIFECYCLE EFFECTS
  // Initialization: Fetch definitions
  useEffect(() => {
    fetchDefinitions();
  }, []);

  // Sync rules list whenever target definition changes
  useEffect(() => {
    if (selectedDefinitionId) {
      fetchRules(selectedDefinitionId);
    } else {
      setRules([]);
    }
  }, [selectedDefinitionId]);

  // Sync Form data state when drawer toggles or swaps context
  useEffect(() => {
    if (editingRule) {
      setFormData({
        name: editingRule.name || '',
        executionOrder: editingRule.executionOrder?.toString() || '8',
        description: editingRule.description || '',
        ruleType: editingRule.ruleType || DEFAULT_RULE_TYPE,
        severity: editingRule.severity || 'Error',
        sqlQuery: editingRule.sqlQuery || '',
        isEnabled: editingRule.isEnabled !== false
      });
    } else {
      setFormData({
        name: '',
        executionOrder: '8',
        description: '',
        ruleType: DEFAULT_RULE_TYPE,
        severity: 'Error',
        sqlQuery: '',
        isEnabled: true
      });
    }
  }, [editingRule, isDrawerOpen]);
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
        const defs = data.definitions.map((def: any) => ({
          id: def.Id || def.id,
          name: def.Name || def.name
        }));
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
          createdBy: rule.CreatedBy || rule.createdBy,
          creatorName: rule.CreatorName || rule.creatorName
        }));
        setRules(mappedRules);
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
        body: JSON.stringify({
          FileDefinitionId: selectedDefinitionId,
          Name: formData.name,
          Description: formData.description,
          RuleType: formData.ruleType,
          Severity: formData.severity,
          ExecutionOrder: parseInt(formData.executionOrder) || 1,
          SqlQuery: formData.sqlQuery,
          IsEnabled: formData.isEnabled
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
      isEnabled: rule.isEnabled
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
              <p className="text-slate-500 mt-1">Manage quality and compliance rules for data integrity platforms.</p>
            </div>
            <button 
              onClick={() => { setEditingRule(null); setIsDrawerOpen(true); }}
              disabled={!selectedDefinitionId}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium px-4 py-2.5 rounded-lg shadow-sm transition-colors text-sm"
            >
              <Plus className="w-4 h-4" /> New Rule
            </button>
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
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-center justify-between gap-6">
            <div className="w-1/4">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Upload Definition</label>
              <div className="relative">
                <select 
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
                            <button 
                              onClick={() => setActiveMenuId(activeMenuId === rule.id ? null : rule.id)}
                              className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {/* Dropdown Action Controls Block */}
                            {activeMenuId === rule.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setActiveMenuId(null)} />
                                <div className="absolute right-0 top-7 w-40 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 text-xs font-medium">
                                  <button onClick={() => { setEditingRule(rule); setIsDrawerOpen(true); setActiveMenuId(null); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700">
                                    <Edit2 className="w-3.5 h-3.5 text-slate-400" /> Edit Configuration
                                  </button>
                                  <button onClick={() => handleClone(rule)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700">
                                    <Copy className="w-3.5 h-3.5 text-slate-400" /> Clone Logic
                                  </button>
                                  <button onClick={() => handleDelete(rule.id)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-red-600 font-semibold border-t border-slate-100">
                                    <Trash2 className="w-3.5 h-3.5 text-red-400" /> Purge Rule
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {rule.description && <p className="text-xs text-slate-500 max-w-3xl line-clamp-2">{rule.description}</p>}
                        <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide">{rule.ruleType}</div>
                        
                        {/* Database Target Expression Container */}
                        {rule.sqlQuery && (
                          <div className="bg-slate-900 border border-slate-950 rounded-lg p-3 font-mono text-xs text-emerald-400 max-w-3xl overflow-x-auto shadow-inner">
                            {rule.sqlQuery}
                          </div>
                        )}

                        {/* Direct Control Actions Inline */}
                        <div className="flex items-center gap-4 pt-1 text-xs font-semibold">
                          <button onClick={() => { setEditingRule(rule); setIsDrawerOpen(true); }} className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700">
                            <Edit2 className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button onClick={() => handleToggle(rule)} className={`flex items-center gap-1.5 transition-colors ${rule.isEnabled ? 'text-slate-500 hover:text-slate-600' : 'text-emerald-600 hover:text-emerald-700'}`}>
                            <Power className="w-3.5 h-3.5" /> {rule.isEnabled ? 'Disable' : 'Enable'}
                          </button>
                        </div>
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
        {isDrawerOpen && (
          <div className="w-[450px] bg-white border border-slate-200 rounded-2xl shadow-lg flex flex-col overflow-hidden self-start sticky top-8 animate-slideLeft">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-blue-600">
                <Shield className="w-5 h-5" />
                <h2 className="font-bold text-lg text-slate-900">
                  {editingRule ? 'Edit Validation Rule' : 'New Validation Rule'}
                </h2>
              </div>
              <button onClick={() => setIsDrawerOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-50">
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
            <form onSubmit={handleSaveRule} className="flex flex-col flex-1 overflow-y-auto">
              <div className="p-6 space-y-5 flex-1">
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">
                    {error}
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-sm text-slate-900">System Parameters</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Define runtime parameters mapped directly to active schemas.</p>
                </div>

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

                {/* Field: Strategy / Rule Type Option Selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600">Evaluation Strategy <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select 
                      value={formData.ruleType}
                      onChange={(e) => setFormData({ ...formData, ruleType: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium shadow-xs"
                    >
                      {!RULE_TYPES.some(t => t.value === formData.ruleType) && (
                        <option value={formData.ruleType} disabled>{formData.ruleType} (no longer supported)</option>
                      )}
                      {RULE_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
                      <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                    </div>
                  </div>
                </div>

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
                <button 
                  type="button"
                  onClick={() => setIsDrawerOpen(false)} 
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm shadow-sm"
                >
                  {editingRule ? 'Update Parameters' : 'Save Validation Rule'} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </form>

          </div>
        )}

      </div>
    </div>
  );
}