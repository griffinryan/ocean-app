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
        title: 'Griffin Ryan - Home',
        description: 'Software engineering portfolio and projects'
      },
      {
        path: 'portfolio',
        state: 'portfolio',
        title: 'Griffin Ryan - Portfolio',
        description: 'Detailed project showcases and case studies'
      },
      {
        path: 'resume',
        state: 'resume',
        title: 'Griffin Ryan - Resume',
        description: 'Professional experience, skills, and qualifications'
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
    // Listen for browser navigation (back/forward buttons)
    window.addEventListener('popstate', () => {
      this.handleNavigation();
    });

    // Handle initial page load
    this.handleNavigation();
  }

  private handleNavigation(): void {
    const path = window.location.pathname.slice(1); // Remove leading /
    const route = this.routes.get(path);

    if (route) {
      this.navigateToRoute(route);
    } else {
      // Handle unknown routes
      this.navigateToNotFound(path);
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
    const url = path ? `/${path}` : '/';
    window.history.pushState(null, '', url);
    this.handleNavigation();
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

  public goToPortfolio(): void {
    this.navigate('portfolio');
  }

  public goToResume(): void {
    this.navigate('resume');
  }

  public goToPaper(): void {
    this.navigate('paper');
  }

  public goBack(): void {
    window.history.back();
  }

  public dispose(): void {
    window.removeEventListener('popstate', () => {});
  }
}