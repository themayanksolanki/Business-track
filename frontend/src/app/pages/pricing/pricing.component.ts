import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface PricingPlan {
  name: string;
  // Per-seat, per-month price at each billing cadence — null means "Custom"
  // (Enterprise), rendered with no per-seat number at all.
  monthlyPrice: number | null;
  annualPrice: number | null;
  tagline: string;
  inheritsFrom: string | null;
  features: string[];
  ctaLabel: string;
  highlighted: boolean;
}

// Annual price is ~20% off the monthly rate on every seat-based tier — the
// same "2 months free"-style discount most collaboration tools (Linear,
// Notion, Asana) use, kept as a flat percentage rather than per-plan figures
// so the "Save 20%" badge stays accurate regardless of which plan it's next to.
const ANNUAL_DISCOUNT_LABEL = 'Save 20%';

const PLANS: PricingPlan[] = [
  {
    name: 'Starter',
    monthlyPrice: 10,
    annualPrice: 8,
    tagline: 'Get visibility into your team’s work.',
    inheritsFrom: null,
    features: ['KPI dashboards', 'Reports', 'Basic calendar'],
    ctaLabel: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Professional',
    monthlyPrice: 20,
    annualPrice: 16,
    tagline: 'Add scheduling and real-time communication.',
    inheritsFrom: 'Starter',
    features: ['1:1 chat', 'Event management', 'Meeting scheduling', 'Integrations'],
    ctaLabel: 'Get Started',
    highlighted: true,
  },
  {
    name: 'Business',
    monthlyPrice: 40,
    annualPrice: 32,
    tagline: 'Scale collaboration and control across teams.',
    inheritsFrom: 'Professional',
    features: ['Group meetings', 'Advanced permissions', 'Analytics', 'APIs'],
    ctaLabel: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Enterprise',
    monthlyPrice: null,
    annualPrice: null,
    tagline: 'For organizations with security and scale requirements.',
    inheritsFrom: null,
    features: ['SSO', 'Audit logs', 'White labeling', 'Dedicated support', 'Custom integrations'],
    ctaLabel: 'Contact Sales',
    highlighted: false,
  },
];

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './pricing.component.html',
  styleUrl: './pricing.component.css',
})
export class PricingComponent {
  readonly plans = PLANS;
  readonly annualDiscountLabel = ANNUAL_DISCOUNT_LABEL;

  annual = false;

  setBillingAnnual(value: boolean) {
    this.annual = value;
  }

  priceFor(plan: PricingPlan): number | null {
    return this.annual ? plan.annualPrice : plan.monthlyPrice;
  }
}
