import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, effect, inject } from '@angular/core';
// Modular import, same reasoning as shared/trend-chart — only the line+area
// combo this component draws is ever needed here.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { ThemeService } from '../../core/services/theme.service';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export interface AreaChartSeries {
  name: string;
  color: string;
  // `null` entries are skipped — the line joins the nearest surrounding
  // non-null points instead of breaking (same convention as TrendChart).
  data: (number | null)[];
}

// Modeled on ECharts' "Stacked Area Chart" example (area-stack) — categories
// on the x-axis, any number of named series drawn as filled line areas. No
// domain knowledge of what the series represent (same "generic chart" rule
// TrendChartComponent/GaugeChartComponent follow), so any caller can reuse
// it — the first is the metric-form-modal Statistics tab plotting
// Actual/Target/Lowest/Medium/Upper together.
@Component({
  selector: 'app-area-chart',
  standalone: true,
  templateUrl: './area-chart.component.html',
  styleUrl: './area-chart.component.css',
})
export class AreaChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() categories: string[] = [];
  @Input() series: AreaChartSeries[] = [];
  @Input() emptyMessage = 'No data yet.';
  // False by default: for series like Actual/Target/Lowest/Medium/Upper —
  // which aren't parts of a whole — literal stacking (ECharts' `stack`
  // option, each series drawn on top of the previous one's cumulative
  // total) would visually sum them into a meaningless combined height.
  // Independent, semi-transparent overlapping areas read correctly instead.
  // Pass `true` for series that genuinely are parts of a whole (the kind of
  // data the ECharts example itself plots — traffic by channel summing to
  // a total).
  @Input() stacked = false;
  @Input() fillOpacity = 0.25;

  @ViewChild('chartHost', { static: true }) chartHost!: ElementRef<HTMLDivElement>;

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly themeService = inject(ThemeService);

  constructor() {
    // Re-render on theme flips — ECharts reads plain JS colors at render
    // time, it can't follow the app's CSS custom properties on its own.
    effect(() => {
      this.themeService.theme();
      this.render();
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['categories'] || changes['series'] || changes['stacked'] || changes['fillOpacity']) this.render();
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

    const textMuted = this.cssVar('--text-muted', '#64748b');
    const border = this.cssVar('--border-strong', '#e2e8f0');
    const cardBg = this.cssVar('--bg-card', '#ffffff');
    const textPrimary = this.cssVar('--text-primary', '#0f172a');

    this.chart.setOption(
      {
        backgroundColor: 'transparent',
        color: this.series.map((s) => s.color),
        tooltip: {
          trigger: 'axis',
          backgroundColor: cardBg,
          borderColor: border,
          textStyle: { color: textPrimary },
          extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.15); border-radius: 8px;',
        },
        legend: {
          data: this.series.map((s) => s.name),
          top: 0,
          textStyle: { color: textMuted },
        },
        grid: { top: 36, left: 8, right: 16, bottom: 8, containLabel: true },
        xAxis: {
          type: 'category',
          data: this.categories,
          axisLine: { lineStyle: { color: border } },
          axisLabel: { color: textMuted },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          splitLine: { lineStyle: { color: border } },
          axisLabel: { color: textMuted },
        },
        series: this.series.map((s) => ({
          name: s.name,
          type: 'line' as const,
          data: s.data,
          color: s.color,
          connectNulls: true,
          symbol: 'circle' as const,
          symbolSize: 6,
          stack: this.stacked ? 'total' : undefined,
          areaStyle: { opacity: this.fillOpacity },
          emphasis: { focus: 'series' as const },
        })),
      },
      true
    );
  }
}
