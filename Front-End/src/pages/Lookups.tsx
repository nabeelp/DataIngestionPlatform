import { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, Plus } from 'lucide-react';

import { apiConfig } from '../config/api';

const API_URL = apiConfig.getBaseUrl();

interface Lookup {
  id: string;
  name: string;
  description: string;
  values: string[];
  createdAt: string;
}

export default function Lookups() {
  const [lookups, setLookups] = useState<Lookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchLookups();
  }, []);

  const fetchLookups = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await axios.get(`${API_URL}/users/lookups`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLookups(response.data.lookups || []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch lookups:', err);
      setError('Failed to load lookups');
      setLookups([
        {
          id: 'lookup-001',
          name: 'currency_codes',
          description: 'ISO currency codes',
          values: ['USD', 'EUR', 'GBP', 'AUD', 'JPY', 'CHF', 'CAD', 'NZD', 'SGD', 'HKD'],
          createdAt: '2024-01-15T00:00:00Z'
        },
        {
          id: 'lookup-002',
          name: 'transaction_types',
          description: 'Types of financial transactions',
          values: ['DEBIT', 'CREDIT', 'TRANSFER', 'REFUND', 'FEE', 'INTEREST', 'PENALTY'],
          createdAt: '2024-01-10T00:00:00Z'
        },
        {
          id: 'lookup-003',
          name: 'country_codes',
          description: 'ISO country codes',
          values: ['US', 'GB', 'DE', 'FR', 'AU', 'JP', 'CA', 'NZ', 'SG', 'HK'],
          createdAt: '2024-01-05T00:00:00Z'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const filteredLookups = lookups.filter(lookup =>
    lookup.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lookup.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="w-full">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Lookups</h1>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Lookups</h1>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center gap-2 w-full sm:w-auto justify-center">
          <Plus size={16} />
          Add Lookup
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-yellow-50 text-yellow-700 rounded-md">
          {error}
        </div>
      )}

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Search lookups..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {filteredLookups.map((lookup) => (
          <div key={lookup.id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 truncate">{lookup.name}</h3>
              <span className="text-xs text-gray-500 flex-shrink-0 ml-2">{lookup.values.length} values</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">{lookup.description}</p>
            <div className="flex flex-wrap gap-1 mb-4">
              {lookup.values.slice(0, 5).map((value, idx) => (
                <span key={idx} className="text-[10px] px-2 py-1 bg-gray-100 text-gray-700 rounded">
                  {value}
                </span>
              ))}
              {lookup.values.length > 5 && (
                <span className="text-[10px] px-2 py-1 text-gray-500">
                  +{lookup.values.length - 5} more
                </span>
              )}
            </div>
            <div className="pt-3 border-t border-gray-100">
              <p className="text-[10px] text-gray-400">Created: {formatDate(lookup.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>

      {filteredLookups.length === 0 && (
        <div className="text-center py-12">
          <Search size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No lookups found</p>
        </div>
      )}
    </div>
  );
}

