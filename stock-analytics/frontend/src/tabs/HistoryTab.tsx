import type { CrawlRun } from '../types'
import { fmtDate, duration } from '../utils'
import { StatusBadge } from '../components/ui'

interface Props {
  runs: CrawlRun[]
}

export function HistoryTab({ runs }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#30363d]">
      {runs.length === 0 ? (
        <div className="px-5 py-10 text-center text-[#8b949e]">No crawl runs yet</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
            <tr>
              {['Job', 'Date', 'Status', 'Records', 'Started', 'Duration', 'Error'].map(h => (
                <th key={h}
                    className="px-4 py-3 text-left font-semibold whitespace-nowrap sticky top-0 z-10 bg-[#161b22]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run, idx) => (
              <tr key={run.id}
                  className={`border-t border-[#30363d]/50 transition-colors hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                    ${idx % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}>
                <td className="px-4 py-2.5 font-medium text-[#e6edf3] whitespace-nowrap">{run.job}</td>
                <td className="px-4 py-2.5 text-[#8b949e] whitespace-nowrap">{run.run_date}</td>
                <td className="px-4 py-2.5"><StatusBadge status={run.status} /></td>
                <td className="px-4 py-2.5 text-[#e6edf3] tabular-nums">{run.records.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-[#8b949e] whitespace-nowrap">{fmtDate(run.started_at)}</td>
                <td className="px-4 py-2.5 text-[#8b949e] tabular-nums whitespace-nowrap">
                  {duration(run.started_at, run.finished_at)}
                </td>
                <td className="px-4 py-2.5 text-red-400 max-w-xs truncate" title={run.error ?? ''}>
                  {run.error ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
