import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

/** DARK_MODE_COLORS from yearn.fi's AllocationChart. */
export const ALLOCATION_COLORS = [
  '#ff6ba5',
  '#ffb3d1',
  '#ff8fbb',
  '#ffd6e7',
  '#d21162',
  '#ff4d94',
];

export interface AllocationSlice {
  name: string;
  value: number;
}

interface AllocationDonutProps {
  data: AllocationSlice[];
  size?: number;
}

export const AllocationDonut: React.FC<AllocationDonutProps> = ({ data, size = 150 }) => {
  if (!data.length) return null;
  const inner = (size / 150) * 50;
  const outer = (size / 150) * 75;

  return (
    <div className="y-allocation__chart" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={inner}
            outerRadius={outer}
            paddingAngle={5}
            startAngle={90}
            endAngle={-270}
            minAngle={3}
            isAnimationActive={false}
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <span className="y-allocation__label">allocation %</span>
    </div>
  );
};
