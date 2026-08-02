import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, effect, inject } from '@angular/core';
// Modular import, same reasoning as shared/trend-chart — only the gauge
// chart type is ever rendered here, no need to pull in the full bundle.
import * as echarts from 'echarts/core';
import { GaugeChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';
import { ThemeService } from '../../core/services/theme.service';

echarts.use([GaugeChart, CanvasRenderer]);

// Generic "progress toward a goal" ring — no domain knowledge of what the
// percent represents (mirrors TrendChartComponent's "no domain knowledge of
// what the lines are" design). Metrics Tiles View is the first caller
// (Actual vs Target), but anything shaped like "a 0-100(+)%, or nothing yet"
// can reuse it — task completion, budget used, capacity, a health score —
// by supplying its own colors/thresholds/label formatter.
@Component({
  selector: 'app-gauge-chart',
  standalone: true,
  templateUrl: './gauge-chart.component.html',
  styleUrl: './gauge-chart.component.css',
})
export class GaugeChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  // Raw percent (0-100 scale) — can exceed 100 (goal exceeded) or be null
  // ("no goal set yet" / no data, rendered as a neutral empty ring).
  @Input() percent: number | null = null;

  // Chart height in px — width always fills the host's container.
  @Input() size = 140;

  // [midBreakpoint, highBreakpoint] on the 0-100 scale: below the first uses
  // `colorLow`, between the two uses `colorMid`, at/above the second uses
  // `colorHigh`. Defaults suit a "closer to the goal is better" reading;
  // pass e.g. [20, 50] with colors reversed for a "lower is better" gauge.
  @Input() thresholds: [number, number] = [50, 80];

  @Input() colorLow = '#ef4444';
  @Input() colorMid = '#f59e0b';
  @Input() colorHigh = '#22c55e';
  @Input() colorNeutral = '#94a3b8';

  // Center label text — only called when `percent` isn't null; `null` always
  // shows `emptyLabel` instead. Default renders a rounded percent sign.
  @Input() valueFormatter: (percent: number) => string = (p) => `${Math.round(p)}%`;
  @Input() emptyLabel = '—';

  @ViewChild('chartHost', { static: true }) chartHost!: ElementRef<HTMLDivElement>;

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly themeService = inject(ThemeService);

  private get color(): string {
    if (this.percent === null) return this.colorNeutral;
    const [mid, high] = this.thresholds;
    if (this.percent < mid) return this.colorLow;
    if (this.percent < high) return this.colorMid;
    return this.colorHigh;
  }

  constructor() {
    // Re-render on theme flips — ECharts reads plain JS colors at render
    // time, it can't follow the app's CSS custom properties on its own.
    effect(() => {
      this.themeService.theme();
      this.render();
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    this.render();
  }

  ngAfterViewInit() {
    this.chart = echarts.init(this.chartHost.nativeElement);
    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(this.chartHost.nativeElement);
    this.render();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }

  private cssVar(name: string, fallback: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  private render() {
    if (!this.chart) return;

    // --border-strong rather than --bg-muted: callers commonly place this
    // gauge on a --bg-muted card (see metric-form-modal's Statistics tab),
    // and a track color equal to its own background disappears entirely —
    // --border-strong stays visibly distinct from both --bg-card and
    // --bg-muted in light and dark theme.
    const track = this.cssVar('--border-strong', '#e2e8f0');
    const color = this.color;
    const percent = this.percent;
    const formatter = this.valueFormatter;
    const emptyLabel = this.emptyLabel;
    // The arc itself always reads 0-100 (visually caps an exceeded goal at a
    // full ring) — the exact number, including anything past 100, still
    // shows in the center label via the formatter below.
    const clamped = percent === null ? 0 : Math.min(100, Math.max(0, percent));

    this.chart.setOption(
      {
        series: [
          {
            type: 'gauge',
            startAngle: 220,
            endAngle: -40,
            min: 0,
            max: 100,
            radius: '92%',
            pointer: { show: false },
            progress: { show: true, width: 12, roundCap: true, itemStyle: { color } },
            axisLine: { roundCap: true, lineStyle: { width: 12, color: [[1, track]] } },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { show: false },
            anchor: { show: false },
            title: { show: false },
            detail: {
              valueAnimation: true,
              offsetCenter: [0, '4%'],
              // Floor at 0 for the label too — matches the arc's own floor,
              // so a stray negative `percent` (e.g. bad data producing a
              // negative actual) can't show "-20%" next to a full-empty ring.
              formatter: () => (percent === null ? emptyLabel : formatter(Math.max(0, percent))),
              color,
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'inherit',
            },
            data: [{ value: clamped }],
          },
        ],
      },
      true
    );
  }
}
