import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { axisProps, gridProps, tooltipProps, legendProps } from '../chartTheme';

/** Daromad va xarajat chizig‘i (mln so‘m). Davrni tashqaridan boshqariladi. */
const RevenueChart = ({ data = [] }) => {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
        <YAxis {...axisProps} width={74} tickFormatter={(value) => `${value} mln`} />
        <Tooltip {...tooltipProps} formatter={(v) => `${v} mln so‘m`} />
        <Legend {...legendProps} />
        <Line type="monotone" dataKey="income" name="Daromad" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
        <Line type="monotone" dataKey="expense" name="Xarajat" stroke="var(--chart-3)" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default RevenueChart;
