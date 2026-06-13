export interface Reading {
  id: string;
  reading_value: number;
  reading_date: string;
  previous_reading: number | null;
  units_consumed: number;
  notes: string | null;
  source: 'manual' | 'mcp' | 'import';
  created_by: string;
  is_verified: boolean;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface Stats {
  totalReadings: number;
  totalConsumed: number;
  totalAmount: number;
  currentMonthConsumed: number;
  currentMonthAmount: number;
}
