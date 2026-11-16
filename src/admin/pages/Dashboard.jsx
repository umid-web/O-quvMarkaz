import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  CreditCard,
  Wallet,
  Receipt,
} from 'lucide-react';
import DashboardHeader from '../components/DashboardHeader';
import StatCard from '../components/StatCard';
import Card from '../components/Card';
import SegmentedControl from '../components/SegmentedControl';
import RevenueChart from '../components/RevenueChart';
import StudentStatsChart from '../components/StudentStatsChart';
import CourseDistributionChart from '../components/CourseDistributionChart';
import PaymentsStatusChart from '../components/PaymentsStatusChart';
import RecentActivities from '../components/RecentActivities';
import { useActivities } from '../activity/activityStore';
import { toLocalStamp } from '../activity/time';
import TodaySchedule from '../components/TodaySchedule';
import Alerts from '../components/Alerts';
import QuickActions from '../components/QuickActions';
import { getPeriodLabel, REVENUE_PERIODS } from '../data/dashboardOptions';
import { buildDashboardData } from '../data/dashboardData';
import { formatMoney } from '../utils/format';
import { downloadCsv } from '../utils/csv';
import { useStudents } from './students/useStudents';
import { isoDate, useExpenses, usePayments } from './finance/financeStore';
import { useTeachers } from './teachers/teachersStore';
import { useSupportTeachers } from './support-teachers/supportStore';
import { useCourses } from './courses/coursesStore';
import { useGroups } from './groups/groupsStore';
import { refreshBackendState } from '../../api/backend';
import './Dashboard.scss';

/**
 * Dashboard sahifasi: ko‘rsatkichlar, tezkor amallar, grafiklar, jadval va ogohlantirishlar.
 */
const Dashboard = () => {
  const [period, setPeriod] = useState('month');
  const [revenuePeriod, setRevenuePeriod] = useState('month');
  const [now] = useState(() => new Date());
  const { students } = useStudents();
  const { payments } = usePayments(students);
  const { expenses } = useExpenses();
  const { teachers } = useTeachers();
  const { supportTeachers } = useSupportTeachers();
  const { courses } = useCourses();
  const { groups } = useGroups();
  const data = useMemo(() => buildDashboardData({ students, payments, expenses, teachers, supportTeachers, courses, groups, period, now }), [students, payments, expenses, teachers, supportTeachers, courses, groups, period, now]);
  const live = useActivities();
  const recent = useMemo(
    () => live.slice(0, 6).map((a) => ({ id: a.id, type: a.module, tone: a.severity, description: a.title, time: toLocalStamp(a.at) })),
    [live],
  );

  const handlePeriodChange = (next) => {
    setPeriod(next);
  };
  const handleRefresh = async () => {
    try {
      await refreshBackendState();
      window.location.reload();
    } catch (error) {
      window.dispatchEvent(new CustomEvent('educontrol:sync-error', { detail: error.message }));
    }
  };

  const { stats } = data;
  const todayKey = isoDate(now);
  const monthKey = todayKey.slice(0, 7);
  const todayPayments = payments.filter((payment) => payment.date === todayKey);
  const monthPayments = payments.filter((payment) => payment.date?.startsWith(monthKey));
  const paymentTotal = (list) => list.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const averagePayment = payments.length ? paymentTotal(payments) / payments.length : 0;
  const { availableRooms, occupiedRooms } = data;
  const periodLabel = getPeriodLabel(period);

  const handleExport = () => {
    const rows = [
      ['Ko‘rsatkich', 'Qiymat'],
      ['Jami talabalar', stats.totalStudents],
      ['Faol talabalar', stats.activeStudents],
      ['Ustozlar', stats.totalTeachers],
      ['Qo‘shimcha ustozlar', stats.extraTeachers],
      ['Faol guruhlar', stats.activeGroups],
      ['Bugungi tushum ', formatMoney(stats.todayIncome)],
      [`Tushum — ${periodLabel} `, formatMoney(stats.periodIncome)],
      ['Qarzdorlik ', formatMoney(stats.unpaidDebts)],
    ];
    downloadCsv('dashboard_statistika.csv', rows);
  };

  return (
    <div className="dashboard-page">
      <DashboardHeader
        period={period}
        setPeriod={handlePeriodChange}
        onRefresh={handleRefresh}
        onExport={handleExport}
      />

      <section className="stats-grid" aria-label="To‘lovlar ko‘rsatkichlari">
        <StatCard title="Bugungi tushum" value={formatMoney(paymentTotal(todayPayments))} icon={Wallet} tone="success" />
        <StatCard title="Joriy oy" value={formatMoney(paymentTotal(monthPayments))} icon={Banknote} tone="primary" />
        <StatCard title={`Tanlangan (${payments.length} ta)`} value={formatMoney(paymentTotal(payments))} icon={Receipt} tone="warning" />
        <StatCard title="O‘rtacha to‘lov" value={formatMoney(averagePayment)} icon={CreditCard} tone="primary" />
      </section>

      <section aria-label="Tezkor amallar">
        <h2 className="section-title">Tezkor amallar</h2>
        <QuickActions />
      </section>

      <section className="grid" aria-label="Grafiklar">
        <Card
          className="span-8"
          title="Daromad va xarajat"
          subtitle="Million so‘mda"
          actions={
            <SegmentedControl
              label="Grafik davri"
              options={REVENUE_PERIODS}
              value={revenuePeriod}
              onChange={setRevenuePeriod}
            />
          }
        >
          <RevenueChart data={data.revenue(revenuePeriod)} />
        </Card>

        <Card className="span-4" title="To‘lovlar holati" subtitle="Talabalar ulushi, %">
          <PaymentsStatusChart data={data.paymentStatus} />
        </Card>

        <Card className="span-6" title="O‘quvchilar statistikasi" subtitle="Haftalar kesimida">
          <StudentStatsChart data={data.studentStats} />
        </Card>

        <Card className="span-6" title="Kurslar bo‘yicha taqsimot" subtitle="Talabalar soni">
          <CourseDistributionChart data={data.courseDist} />
        </Card>
      </section>

      <section className="grid" aria-label="Bugungi ma'lumotlar">
        <Card className="span-8" title="Bugungi darslar">
          <TodaySchedule schedule={data.schedule} availableRooms={availableRooms} occupiedRooms={occupiedRooms} />
        </Card>

        <div className="span-4 stack">
          <Card title="Ogohlantirishlar">
            <Alerts alerts={data.alerts} />
          </Card>
          <Card
            title="So‘nggi faoliyatlar"
            actions={<Link to="/admin/activity" className="btn btn--ghost btn--sm">Barchasi</Link>}
          >
            <RecentActivities activities={recent} />
          </Card>
        </div>
      </section>
    </div>
  );
};

export default Dashboard;



