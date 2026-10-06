import {
  BarChart,
  BubbleChart,
  BulletChart,
  CalendarHeatmap,
  ChartCard,
  CohortChart,
  ComboChart,
  DonutChart,
  FunnelChart,
  Gauge,
  HeatmapChart,
  HistogramChart,
  HorizontalBarChart,
  OrgChart,
  RadarChart,
  RangeChart,
  ScatterChart,
  Sparkline,
  Stack,
  StackedAreaChart,
  StackedBarChart,
  Text,
  TimelineChart,
  TreemapChart,
  TrendChart,
  WaterfallChart,
} from '@reach/ui-native';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const months = (values: readonly number[]) =>
  values.map((value, i) => ({
    label: MONTHS[i] ?? '',
    axisLabel: (MONTHS[i] ?? '').charAt(0),
    value,
  }));
const teams = [
  { label: 'Engineering', value: 124 },
  { label: 'Sales', value: 64 },
  { label: 'Support', value: 48 },
  { label: 'Design', value: 28 },
];
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** Lane E's charts, rendered by Metro on a device: every chart once. */
export function ChartsGallery(): React.JSX.Element {
  return (
    <Stack gap={3}>
      <Text variant="title2">Charts</Text>
      <ChartCard title="Hires, 2026" value="82">
        <BarChart
          label="Hires by month"
          data={months([6, 9, 7, 12, 10, 8, 5, 11, 14])}
          highlightIndex={8}
        />
      </ChartCard>
      <ChartCard title="Headcount by team">
        <HorizontalBarChart label="Headcount by team" data={teams} />
      </ChartCard>
      <ChartCard title="Hires by level">
        <StackedBarChart
          label="Hires by level"
          categories={['Q1', 'Q2', 'Q3']}
          series={[
            { label: 'Junior', values: [8, 12, 10] },
            { label: 'Senior', values: [4, 6, 6] },
          ]}
        />
      </ChartCard>
      <ChartCard title="Headcount" value="312">
        <TrendChart
          label="Headcount"
          area
          showLastPoint
          zoomable
          brush
          series={[
            { label: 'Headcount', data: months([263, 266, 271, 274, 279, 285, 289, 294, 297]) },
          ]}
        />
      </ChartCard>
      <Sparkline label="Open roles" data={months([11, 12, 12, 14, 13, 15, 16, 18])} width={120} />
      <ChartCard title="By team">
        <DonutChart label="Headcount by team" data={teams} centerLabel="people" />
      </ChartCard>
      <ChartCard title="Leave by day">
        <HeatmapChart
          label="Leave by week and day"
          rows={['W1', 'W2']}
          columns={days}
          columnLabel={(d) => d.charAt(0)}
          cells={[2, 4, 6, 5, 3, 3, 6, 9, 8, 5].map((value, i) => ({
            row: i < 5 ? 'W1' : 'W2',
            column: days[i % 5] ?? '',
            value,
          }))}
        />
      </ChartCard>
      <ChartCard title="Sick days">
        <CalendarHeatmap
          label="Sick days"
          from="2026-05-04"
          to="2026-06-28"
          tone="danger"
          data={[
            { date: '2026-05-06', value: 4 },
            { date: '2026-05-13', value: 2 },
          ]}
        />
      </ChartCard>
      <ChartCard title="Hiring, Q3">
        <FunnelChart
          label="Hiring funnel"
          highlightBiggestDrop
          data={[
            { label: 'Applied', value: 1240 },
            { label: 'Screened', value: 420 },
            { label: 'Hired', value: 19 },
          ]}
        />
      </ChartCard>
      <ChartCard title="Who is away">
        <TimelineChart
          label="Who is away"
          domain={{ start: '2026-03-09', end: '2026-03-20' }}
          today="2026-03-11"
          editable
          onItemMove={() => undefined}
          rows={[
            {
              label: 'Amara',
              items: [
                {
                  id: 'a',
                  label: 'Vacation',
                  start: '2026-03-09',
                  end: '2026-03-13',
                  tone: 'info',
                },
              ],
            },
            {
              label: 'Omar',
              items: [
                { id: 'o', label: 'Sick', start: '2026-03-11', end: '2026-03-12', tone: 'danger' },
              ],
            },
          ]}
        />
      </ChartCard>
      <OrgChart
        label="Reporting lines"
        nodes={[
          { id: 'nora', name: 'Nora Becker', title: 'Chief Executive' },
          { id: 'jonas', name: 'Jonas Weber', title: 'CTO', parentId: 'nora' },
          { id: 'priya', name: 'Priya Shah', title: 'Senior Engineer', parentId: 'jonas' },
          { id: 'open', name: '', title: 'Sales Engineer', parentId: 'nora', vacant: true },
        ]}
      />
      <ChartCard title="Headcount, Q3" value="297 → 312">
        <WaterfallChart
          label="Headcount movement"
          data={[
            { label: '1 Jul', value: 297, total: true },
            { label: 'Hires', value: 32 },
            { label: 'Leavers', value: -17 },
            { label: '30 Sep', value: 312, total: true },
          ]}
        />
      </ChartCard>
      <ChartCard title="Bands, €k">
        <RangeChart
          label="Salary bands"
          valueLabel="Base salary"
          format={(cents) => String(Math.round(cents / 100_000))}
          data={[
            {
              label: 'Engineer L2',
              min: 6_200_000,
              max: 8_200_000,
              mid: 7_200_000,
              people: [6_400_000, 8_500_000],
            },
          ]}
        />
      </ChartCard>
      <ChartCard title="Salary vs level">
        <ScatterChart
          label="Salary against level"
          xLabel="Level"
          yLabel="Salary"
          fitLines
          data={[
            { label: 'Priya Shah', x: 1, y: 64, group: 'Women' },
            { label: 'Mei Tanaka', x: 2, y: 78, group: 'Women' },
            { label: 'Jonas Weber', x: 1, y: 66, group: 'Men' },
            { label: 'Omar Haddad', x: 2, y: 80, group: 'Men' },
          ]}
        />
      </ChartCard>
      <ChartCard title="Hires vs attrition">
        <ComboChart
          label="Hires and attrition"
          barLabel="Hires (left)"
          lineLabel="Attrition % (right)"
          data={[6, 9, 7, 12].map((bar, i) => ({
            label: MONTHS[i] ?? '',
            bar,
            line: [7.9, 7.6, 7.4, 7.1][i] ?? 0,
          }))}
        />
      </ChartCard>
      <ChartCard title="Headcount by team">
        <StackedAreaChart
          label="Headcount by team"
          categories={['Mar', 'Apr', 'May']}
          series={[
            { label: 'Engineering', values: [100, 104, 108] },
            { label: 'Sales', values: [52, 54, 56] },
          ]}
        />
      </ChartCard>
      <Gauge value={72} label="Hiring plan" description="of hiring plan" />
      <ChartCard title="Skills">
        <RadarChart
          label="Skills"
          axes={['Delivery', 'Quality', 'Collaboration', 'Ownership', 'Mentoring']}
          series={[{ label: 'Priya', values: [4, 5, 4, 4, 3] }]}
        />
      </ChartCard>
      <ChartCard title="Payroll by team">
        <TreemapChart label="Payroll by team" data={teams} />
      </ChartCard>
      <ChartCard title="Tenure">
        <HistogramChart
          label="Tenure"
          values={[0.5, 1.2, 1.5, 2.3, 2.4, 3.1, 4.8, 6.2]}
          step={1}
          start={1}
          end={6}
        />
      </ChartCard>
      <ChartCard title="Retention">
        <CohortChart
          label="Retention"
          periods={['M0', 'M3', 'M6']}
          cohorts={[
            { label: 'Q1', values: [100, 96, 92] },
            { label: 'Q2', values: [100, 97, null] },
          ]}
        />
      </ChartCard>
      <ChartCard title="Q3 goals">
        <BulletChart
          label="Q3 goals"
          data={[
            { label: 'Hires', value: 30, target: 25, max: 40, bands: [15, 25], display: '30 / 25' },
          ]}
        />
      </ChartCard>
      <ChartCard title="Teams">
        <BubbleChart
          label="Teams"
          xLabel="Tenure"
          yLabel="Engagement"
          sizeLabel="Headcount"
          data={[
            { label: 'Eng', x: 18, y: 72, size: 124 },
            { label: 'Sales', x: 40, y: 58, size: 64 },
          ]}
        />
      </ChartCard>
    </Stack>
  );
}
