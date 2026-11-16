export const PERIODS = [
  { value: 'today', label: 'Bugun' },
  { value: 'week', label: '7 kun' },
  { value: 'month', label: '30 kun' },
  { value: 'year', label: '1 yil' },
  { value: 'all', label: 'Barcha vaqt' },
];

export const REVENUE_PERIODS = [
  { value: 'day', label: 'Kun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'year', label: 'Yil' },
];

export const getPeriodLabel = (period) => PERIODS.find((item) => item.value === period)?.label ?? '';
