import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, effect, inject } from '@angular/core';
// Modular import instead of the full `echarts` bundle — mirrors
// shared/tree-chart's reasoning: pulling in every chart type would balloon
// whichever lazy chunk uses this for a component that only ever renders
// line series.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { ThemeService } from '../../core/services/theme.service';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export interface TrendChartSeries {
  name: string;
  color: string;
  // `null` entries are skipped — the line joins the nearest surrounding
  // non-null points instead of breaking.
  data: (number | null)[];
}

// Generic named-line-series chart — categories on the x-axis, any number of
// named series on the y-axis. No domain knowledge of what the lines
// represent (Actual/Target, or anything else a future caller plots), so any
// module can reuse it the same way shared/tree-chart is reused across
// Departments/Categories.
@Component({
  selector: 'app-trend-chart',
  standalone: true,
  templateUrl: './trend-chart.component.html',
  styleUrl: './trend-chart.component.css',
})
export class TrendChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() categories: string[] = [];
  @Input() series: TrendChartSeries[] = [];
  @Input() emptyMessage = 'No data yet.';

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
    if (changes['categories'] || changes['series']) this.render();
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
        })),
      },
      true
    );
  }
}
