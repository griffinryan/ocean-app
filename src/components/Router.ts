/**
 * Simple Router System for Ocean Portfolio
 * Handles navigation and state management
 */

import { PanelManager, PanelState } from './Panel';

export interface Route {
  path: string;
  state: PanelState;
  title: string;
  description?: string;
}

export class Router {
  private panelManager: PanelManager;
  private routes: Map<string, Route> = new Map();
  private currentRoute: Route | null = null;

  constructor(panelManager: PanelManager) {
    this.panelManager = panelManager;
    this.initializeRoutes();
    this.setupRouting();
  }

  private initializeRoutes(): void {
    const routes: Route[] = [
      {
        path: '',
        state: 'landing',
        title: 'Griffin Ryan - Ocean Portfolio',
        description: 'Interactive ocean simulation and portfolio website'
      },
      {
        path: 'app',
        state: 'app',
        title: 'Griffin Ryan - Portfolio',
        description: 'Software engineering portfolio and projects'
      },
      {
        path: 'paper',
        state: 'paper',
        title: 'Research Paper - Ocean Simulation',
        description: 'Technical documentation and research'
      }
    ];

    routes.forEach(route => {
      this.routes.set(route.path, route);
    });
  }

  private setupRouting(): void {
    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      this.handleNavigation();
    });

    // Handle initial page load
    this.handleNavigation();
  }

  private handleNavigation(): void {
    const hash = window.location.hash.slice(1); // Remove #
    const route = this.routes.get(hash);

    if (route) {
      this.navigateToRoute(route);
    } else {
      // Handle unknown routes
      this.navigateToNotFound(hash);
    }
  }

  private navigateToRoute(route: Route): void {
    this.currentRoute = route;

    // Update document title
    document.title = route.title;

    // Update meta description if available
    if (route.description) {
      this.updateMetaDescription(route.description);
    }

    // Transition to the new state
    this.panelManager.transitionTo(route.state);

    // Log navigation for debugging
    console.log(`Navigated to: ${route.path} (${route.state})`);
  }

  private navigateToNotFound(path: string): void {
    console.warn(`Route not found: ${path}`);

    // Update title to show 404
    document.title = 'Not Found - Griffin Ryan';

    // Transition to not-found state
    this.panelManager.transitionTo('not-found');
  }

  private updateMetaDescription(description: string): void {
    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement;

    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.name = 'description';
      document.head.appendChild(metaDesc);
    }

    metaDesc.content = description;
  }

  // Public API methods
  public navigate(path: string): void {
    window.location.hash = path;
  }

  public getCurrentRoute(): Route | null {
    return this.currentRoute;
  }

  public addRoute(route: Route): void {
    this.routes.set(route.path, route);
  }

  public removeRoute(path: string): void {
    this.routes.delete(path);
  }

  public getRoutes(): Route[] {
    return Array.from(this.routes.values());
  }

  // Helper methods for common navigation
  public goHome(): void {
    this.navigate('');
  }

  public goToApp(): void {
    this.navigate('app');
  }

  public goToPaper(): void {
    this.navigate('paper');
  }

  public goBack(): void {
    window.history.back();
  }

  public dispose(): void {
    window.removeEventListener('hashchange', () => {});
  }
}