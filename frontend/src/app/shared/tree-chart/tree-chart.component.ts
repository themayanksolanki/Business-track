import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
// Modular import instead of the full `echarts` bundle — pulling in every
// chart type/component would balloon the Settings lazy chunk by ~2.5MB for
// a page that only ever renders a single tree series.
import * as echarts from 'echarts/core';
import { TreeChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { ThemeService } from '../../core/services/theme.service';

echarts.use([TreeChart, TooltipComponent, LegendComponent, CanvasRenderer]);

export interface TreeChartStat {
  label: string;
  value: number;
}

// Generic recursive tree-node shape — deliberately has no notion of
// "department"/"metric"/etc. so this component can render any hierarchy
// (departments, metric parent/child trees, category trees, ...) as long as
// the caller adapts its own model into this shape first.
export interface TreeChartNode {
  id: number | string;
  name: string;
  // Falls back to a default blue when omitted, since not every consumer
  // (e.g. a metric with no color of its own) has a natural color source.
  color?: string;
  stats?: TreeChartStat[];
  children?: TreeChartNode[];
}

const DEFAULT_COLOR = '#3b82f6';

@Component({
  selector: 'app-tree-chart',
  standalone: true,
  templateUrl: './tree-chart.component.html',
  styleUrl: './tree-chart.component.css',
})
export class TreeChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  // Each entry becomes its own ECharts "tree" series with its own legend
  // entry (toggle to hide/show one whole tree) — mirrors the multi-tree
  // legend example this was modeled on, and maps naturally onto multiple
  // top-level records (root departments, root categories, ...).
  @Input() trees: TreeChartNode[] = [];
  @Input() emptyMessage = 'Nothing to visualize yet.';
  @Output() nodeClicked = new EventEmitter<TreeChartNode>();

  @ViewChild('chartHost', { static: true }) chartHost!: ElementRef<HTMLDivElement>;

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly themeService = inject(ThemeService);
  private nodesById = new Map<string, TreeChartNode>();

  constructor() {
    // Re-render on theme flips — ECharts reads plain JS colors at render
    // time, it can't follow the app's CSS custom properties on its own.
    effect(() => {
      this.themeService.theme();
      this.render();
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['trees']) this.render();
  }

  ngAfterViewInit() {
    this.chart = echarts.init(this.chartHost.nativeElement);
    this.chart.on('click', (params) => {
      const id = (params.data as { __id?: string } | undefined)?.__id;
      const node = id !== undefined ? this.nodesById.get(id) : undefined;
      if (node) this.nodeClicked.emit(node);
    });
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

  private toEChartsNode(node: TreeChartNode): object {
    const color = node.color || DEFAULT_COLOR;
    const id = String(node.id);
    this.nodesById.set(id, node);
    return {
      name: node.name,
      __id: id,
      stats: node.stats ?? [],
      itemStyle: { color, borderColor: color },
      lineStyle: { color },
      label: { color },
      children: (node.children ?? []).map((child) => this.toEChartsNode(child)),
    };
  }

  private formatTooltip(params: { name: string; data: { stats?: TreeChartStat[] } }): string {
    const stats = params.data.stats ?? [];
    if (!stats.length) return `<div style="font-weight:600;">${params.name}</div>`;
    const rows = stats
      .map(
        (s) =>
          `<div style="display:flex;justify-content:space-between;gap:20px;"><span>${s.label}</span><strong>${s.value}</strong></div>`
      )
      .join('');
    return `<div style="font-weight:600;margin-bottom:4px;">${params.name}</div>${rows}`;
  }

  private render() {
    if (!this.chart) return;
    this.nodesById.clear();

    const textPrimary = this.cssVar('--text-primary', '#0f172a');
    const textMuted = this.cssVar('--text-muted', '#64748b');
    const textDim = this.cssVar('--text-dim', '#94a3b8');
    const border = this.cssVar('--border-strong', '#e2e8f0');
    const cardBg = this.cssVar('--bg-card', '#ffffff');

    const series = this.trees.map((root) => {
      const color = root.color || DEFAULT_COLOR;
      return {
        type: 'tree' as const,
        name: root.name,
        data: [this.toEChartsNode(root)],
        top: '4%',
        left: '9%',
        bottom: '4%',
        right: '20%',
        symbolSize: 9,
        orient: 'LR' as const,
        // Mouse wheel to zoom, drag to pan.
        roam: true,
        expandAndCollapse: true,
        initialTreeDepth: -1,
        itemStyle: { color, borderColor: color },
        lineStyle: { color, curveness: 0.5, width: 1.5 },
        label: { position: 'left' as const, verticalAlign: 'middle' as const, align: 'right' as const, fontSize: 12, color },
        leaves: { label: { position: 'right' as const, verticalAlign: 'middle' as const, align: 'left' as const } },
        emphasis: { focus: 'descendant' as const },
        animationDuration: 400,
        animationDurationUpdate: 500,
      };
    });

    this.chart.setOption(
      {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          triggerOn: 'mousemove',
          backgroundColor: cardBg,
          borderColor: border,
          textStyle: { color: textPrimary },
          extraCssText: `box-shadow: 0 4px 16px rgba(0,0,0,0.15); border-radius: 8px;`,
          formatter: (params: unknown) => this.formatTooltip(params as { name: string; data: { stats?: TreeChartStat[] } }),
        },
        legend: {
          top: 4,
          left: 4,
          data: this.trees.map((t) => t.name),
          textStyle: { color: textMuted },
          inactiveColor: textDim,
        },
        series,
      },
      true
    );
  }
}
