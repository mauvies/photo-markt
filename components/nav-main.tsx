'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';

export function NavMains({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon: LucideIcon;
    isActive?: boolean;
    items?: {
      title: string;
      url: string;
    }[];
  }[];
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  const handleLinkClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const isItemActive = (url: string, allUrls: string[]) => {
    if (url.endsWith('/dashboard/photographer') || url.endsWith('/dashboard/talent')) {
      // Exact match for dashboard home pages (works with any locale prefix)
      return pathname === url;
    }

    // Check for exact match first
    if (pathname === url) {
      return true;
    }

    // Check if pathname starts with URL followed by `/` (for sub-routes)
    // But only if no other URL is a more specific match
    if (pathname.startsWith(`${url}/`)) {
      // Check if any other URL is a more specific match (longer and also matches)
      const hasMoreSpecificMatch = allUrls.some(
        (otherUrl) =>
          (otherUrl !== url &&
            otherUrl.length > url.length &&
            pathname.startsWith(`${otherUrl}/`)) ||
          pathname === otherUrl,
      );
      return !hasMoreSpecificMatch;
    }

    return false;
  };

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          const allUrls = items.map((i) => i.url);
          const isActive = isItemActive(item.url, allUrls);
          return (
            <Collapsible key={item.title} asChild defaultOpen={isActive}>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                  <Link href={item.url} onClick={handleLinkClick}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {item.items?.length ? (
                  <>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction className="data-[state=open]:rotate-90">
                        <ChevronRight />
                        <span className="sr-only">Toggle</span>
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items?.map((subItem) => {
                          const allSubUrls = item.items?.map((i) => i.url) ?? [];
                          const isSubItemActive = isItemActive(subItem.url, allSubUrls);
                          return (
                            <SidebarMenuSubItem key={subItem.title}>
                              <SidebarMenuSubButton asChild isActive={isSubItemActive}>
                                <Link href={subItem.url} onClick={handleLinkClick}>
                                  <span>{subItem.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </>
                ) : null}
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
