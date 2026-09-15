import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import { CONTENDER_COLORS } from './resultsUtils';
import './ResultsChart.css';

/**
 * Custom Tooltip Component for Recharts BarChart
 */
function ChartTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const item = payload[0].payload;
    return (
      <div className="results-chart-tooltip" role="tooltip">
        <p className="tooltip-candidate">{item.candidate || item.name}</p>
        <p className="tooltip-votes">
          <strong>{item.votes.toLocaleString()}</strong> votes
        </p>
        <p className="tooltip-pct">{item.percentage}% share</p>
      </div>
    );
  }
  return null;
}

/**
 * ResultsChart Component
 *
 * Presentation-focused pairwise voting bar chart built with Recharts.
 * Accepts pure chart data prepared by resultsUtils without directly querying
 * sockets, MongoDB, or mutating Redux tournament state.
 *
 * @param {object} props
 * @param {Array<{ candidate: string, name?: string, votes: number, percentage: number, fill?: string }>} props.data
 * @param {number} [props.totalVotes=0]
 * @param {string} [props.title="Pairwise Vote Distribution"]
 */
function ResultsChart({
  data = [],
  totalVotes = 0,
  title = 'Pairwise Vote Distribution'
}) {
  const hasData = Array.isArray(data) && data.length > 0;
  const computedTotal = totalVotes || (hasData ? data.reduce((sum, item) => sum + (item.votes || 0), 0) : 0);

  if (!hasData) {
    return (
      <div className="results-chart-card empty" role="region" aria-label={title}>
        <p className="results-chart-empty">No chart data available for this round.</p>
      </div>
    );
  }

  return (
    <section
      className="results-chart-card"
      role="region"
      aria-label={title}
    >
      <header className="results-chart-header">
        <div>
          <span className="results-chart-eyebrow">CHART VISUALIZATION</span>
          <h3 className="results-chart-title">{title}</h3>
        </div>
        <div className="results-chart-badge" aria-label={`Total Votes: ${computedTotal}`}>
          <span>Total Votes:</span>
          <strong>{computedTotal.toLocaleString()}</strong>
        </div>
      </header>

      {/* Primary SVG Chart Visualization */}
      <div className="results-chart-canvas-wrapper" aria-hidden="false">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 30, left: 10, bottom: 25 }}
          >
            <XAxis
              dataKey="name"
              stroke="#64748b"
              tick={{ fill: '#cbd5e1', fontSize: 13, fontWeight: 500 }}
              tickLine={{ stroke: '#475569' }}
              axisLine={{ stroke: '#475569' }}
            />
            <YAxis
              stroke="#64748b"
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              tickLine={{ stroke: '#475569' }}
              axisLine={{ stroke: '#475569' }}
              allowDecimals={false}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
            />
            <Bar
              dataKey="votes"
              radius={[6, 6, 0, 0]}
              maxBarSize={80}
            >
              {data.map((entry, index) => (
                <Cell
                  key={entry.candidate || index}
                  fill={entry.fill || CONTENDER_COLORS[index % CONTENDER_COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Accessible Table Representation for Screen Readers & Non-Visual Users */}
      <table className="results-chart-accessible-table" aria-label={`${title} Summary Data`}>
        <caption className="sr-only">{title} data table for assistive technology</caption>
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col">Votes</th>
            <th scope="col">Vote Share</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={item.candidate}>
              <td>{item.candidate}</td>
              <td>{item.votes}</td>
              <td>{item.percentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Numerical Indicator Legend */}
      <footer className="results-chart-legend" aria-hidden="true">
        {data.map((item, index) => (
          <div key={item.candidate} className="chart-legend-item">
            <span
              className="legend-color-dot"
              style={{ backgroundColor: item.fill || CONTENDER_COLORS[index % CONTENDER_COLORS.length] }}
            />
            <span className="legend-candidate">{item.candidate}:</span>
            <span className="legend-votes">{item.votes.toLocaleString()} votes</span>
            <span className="legend-pct">({item.percentage}%)</span>
          </div>
        ))}
      </footer>
    </section>
  );
}

export default ResultsChart;
