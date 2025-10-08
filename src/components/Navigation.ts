/**
 * Navigation Manager for Apple Liquid Glass Navigation Bar
 * Handles navbar state, interactions, and integration with routing
 */

import { Router } from './Router';
import { PanelState } from './Panel';

export interface NavigationItem {
  id: string;
  label: string;
  route: string;
  isExternal?: boolean;
  href?: string;
}

export interface NavigationState {
  isVisible: boolean;
  activeItem: string;
  isScrolled: boolean;
}

export class NavigationManager {
  private navbar: HTMLElement;
  private navItems: NodeListOf<HTMLElement>;
  private brandElement: HTMLElement;
  private router: Router;

  private state: NavigationState = {
    isVisible: false,
    activeItem: 'home',
    isScrolled: false
  };

  private navigationItems: NavigationItem[] = [
    { id: 'home', label: 'Home', route: 'app' },
    { id: 'portfolio', label: 'Portfolio', route: 'portfolio' },
    { id: 'resume', label: 'Resume', route: 'resume' },
    {
      id: 'contact',
      label: 'Contact',
      route: '',
      isExternal: true,
      href: 'mailto:griffin@griffinryan.com'
    }
  ];

  constructor(router: Router) {
    this.router = router;

    // Get navbar elements
    this.navbar = this.getElement('navbar');
    this.navItems = this.navbar.querySelectorAll('.nav-item');
    this.brandElement = this.getElement('nav-brand');

    this.setupEventListeners();
    this.initializeState();
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Navigation element with ID '${id}' not found`);
    }
    return element;
  }

  private setupEventListeners(): void {
    // Navigation item clicks
    this.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleNavItemClick(item);
      });
    });

    // Brand/logo click - go to landing page
    this.brandElement.addEventListener('click', (e) => {
      e.preventDefault();
      this.router.goHome();
    });

    // Scroll detection for navbar styling
    window.addEventListener('scroll', () => {
      this.handleScroll();
    });

    // Listen for route changes to update active state
    window.addEventListener('popstate', () => {
      this.updateActiveState();
    });

  }

  private handleNavItemClick(item: HTMLElement): void {
    const navId = item.getAttribute('data-nav');
    if (!navId) return;

    const navItem = this.navigationItems.find(nav => nav.id === navId);
    if (!navItem) return;

    if (navItem.isExternal && navItem.href) {
      // Handle external links (like contact email)
      window.open(navItem.href, '_blank');
      return;
    }

    this.navigateToSection(navItem.id);
  }

  private navigateToSection(sectionId: string): void {
    const navItem = this.navigationItems.find(nav => nav.id === sectionId);
    if (!navItem) return;

    // Update active state immediately for smooth UI response
    this.setActiveItem(sectionId);

    // Navigate using router
    this.router.navigate(navItem.route);
  }

  private handleScroll(): void {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const isScrolled = scrollTop > 20;

    if (isScrolled !== this.state.isScrolled) {
      this.state.isScrolled = isScrolled;
      this.updateNavbarScollState();
    }
  }

  private updateNavbarScollState(): void {
    if (this.state.isScrolled) {
      this.navbar.classList.add('scrolled');
    } else {
      this.navbar.classList.remove('scrolled');
    }
  }

  private updateActiveState(): void {
    const currentRoute = this.router.getCurrentRoute();
    if (!currentRoute) return;

    const activeNavItem = this.navigationItems.find(nav => nav.route === currentRoute.path);
    if (activeNavItem) {
      this.setActiveItem(activeNavItem.id);
    }
  }

  private setActiveItem(itemId: string): void {
    this.state.activeItem = itemId;

    // Update visual active states
    this.navItems.forEach(item => {
      const navId = item.getAttribute('data-nav');
      if (navId === itemId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  private initializeState(): void {
    // Initialize based on current route
    this.updateActiveState();

    // Set initial scroll state
    this.handleScroll();
  }

  // Public API methods

  public show(): void {
    if (this.state.isVisible) return;

    this.state.isVisible = true;
    this.navbar.classList.remove('hidden');
    this.navbar.classList.add('navbar-enter');

    setTimeout(() => {
      this.navbar.classList.remove('navbar-enter');
      this.navbar.classList.add('navbar-visible');
    }, 50);
  }

  public hide(): void {
    if (!this.state.isVisible) return;

    this.state.isVisible = false;
    this.navbar.classList.add('navbar-exit');

    setTimeout(() => {
      this.navbar.classList.remove('navbar-visible', 'navbar-exit');
      this.navbar.classList.add('hidden');
    }, 300);
  }

  public isVisible(): boolean {
    return this.state.isVisible;
  }

  public getActiveItem(): string {
    return this.state.activeItem;
  }

  public setActiveSection(sectionId: string): void {
    this.setActiveItem(sectionId);
  }

  // Get navigation state for external use
  public getState(): NavigationState {
    return { ...this.state };
  }

  // Update navigation visibility based on panel state
  public updateVisibilityForPanelState(panelState: PanelState): void {
    switch (panelState) {
      case 'landing':
        this.hide();
        break;
      case 'app':
      case 'portfolio':
      case 'resume':
        this.show();
        break;
      case 'not-found':
      case 'paper':
        this.hide();
        break;
    }
  }

  public dispose(): void {
    // Clean up event listeners
    this.navItems.forEach(item => {
      const clonedItem = item.cloneNode(true);
      item.parentNode?.replaceChild(clonedItem, item);
    });

    const clonedBrand = this.brandElement.cloneNode(true);
    this.brandElement.parentNode?.replaceChild(clonedBrand, this.brandElement);

    window.removeEventListener('scroll', () => {});
    window.removeEventListener('popstate', () => {});
    document.removeEventListener('keydown', () => {});
  }
}
