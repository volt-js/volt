import { Component, Signal } from '@voltdev/core';
import { VBreadcrumb, VBreadcrumbItem } from '@voltdev/ui/components';

interface Crumb {
  readonly name: string;
  readonly href: string;
}

@Component({
  selector: 'v-file-path',
  templateUrl: './breadcrumb.html',
  styleUrl: './breadcrumb.scss',
  imports: [VBreadcrumb, VBreadcrumbItem],
})
export class FilePath {
  /** Root first, the page last: what a router's matched routes would give. */
  trail: readonly Crumb[] = [
    { name: 'Home', href: '#home' },
    { name: 'Projects', href: '#projects' },
    { name: 'Volt', href: '#volt' },
    { name: 'Packages', href: '#packages' },
    { name: 'UI', href: '#ui' },
    { name: 'Components', href: '#components' },
    { name: 'Breadcrumb', href: '#breadcrumb' },
  ];

  folded = new Signal.State(0);

  heard = (collapsed: readonly number[]): void => {
    this.folded.set(collapsed.length);
  };

  summary(): string {
    const folded = this.folded.get();
    if (folded === 0) return 'Every crumb fits. Narrow the box to fold the middle away.';
    return `${folded} ${folded === 1 ? 'crumb is' : 'crumbs are'} behind the … button.`;
  }
}
