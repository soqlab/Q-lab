"use client";

import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type DataPoint = {
  name: string;
  depth: number;
  qubits: number;
  health: number;
};

export default function GateDepthChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa8b6", fontSize: 13 }}>
        No run data yet.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9ef" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="depth" fill="#1d6f8f" radius={[3, 3, 0, 0]} name="Depth" />
        <Bar dataKey="health" fill="#27ae60" radius={[3, 3, 0, 0]} name="Health" />
      </BarChart>
    </ResponsiveContainer>
  );
}
