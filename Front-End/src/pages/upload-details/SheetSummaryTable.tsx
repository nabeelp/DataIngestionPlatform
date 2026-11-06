import type { SheetSummary } from './types';

const SheetRow = ({ index, name, rows, status, path }: { index: string; name: string; rows: number; status: string; path: string }) => {
  const statusClass = status === 'Delivered' || status === 'Validated' ? 'bg-[#f0fdf4] text-[#22c55e]' :
                     status === 'Failed' ? 'bg-[#fef2f2] text-[#ef4444]' : 
                     'bg-[#fffbeb] text-[#f59e0b]';
  
  return (
    <tr className="text-[12px] hover:bg-gray-50">
      <td className="px-6 py-3 text-gray-400">{index}</td>
      <td className="px-6 py-3 font-semibold text-gray-700">{name}</td>
      <td className="px-6 py-3 text-gray-500">{rows.toLocaleString()}</td>
      <td className="px-6 py-3">
        <span className={`${statusClass} text-[9px] px-1.5 py-0.5 rounded font-bold uppercase`}>
          {status}
        </span>
      </td>
      <td className="px-6 py-4">
        {path ? (
          <span className="font-mono text-sm font-medium text-blue-600 break-all hover:underline cursor-pointer" title={`Copy: ${path}`}>
            {path}
          </span>
        ) : (
          <span className="text-sm font-medium text-orange-600 italic">Not Delivered</span>
        )}
      </td>

    </tr>
  );
};

export default function SheetSummaryTable({ sheets }: { sheets: SheetSummary[] }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-800">Sheet Summary</h3>
      </div>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-white text-[10px] uppercase tracking-wider text-gray-400 font-bold border-b border-gray-50">
            <th className="px-6 py-3">Index</th>
            <th className="px-6 py-3">Sheet Name</th>
            <th className="px-6 py-3">Rows</th>
            <th className="px-6 py-3">Status</th>
            <th className="px-6 py-3">Delivery Path</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {sheets.map((sheet) => (
            <SheetRow 
              key={sheet.index}
              index={sheet.index}
              name={sheet.name}
              rows={sheet.rows}
              status={sheet.status}
              path={sheet.deliveryPath}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}
