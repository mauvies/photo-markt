'use client';

import type { User } from '@supabase/supabase-js';
import { LayoutDashboard, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/database/client';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface Props {
  user: User;
}

export function UserAvatar({ user }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const lp = useLocalizedPath();
  const { t } = useTranslations<Dictionary['nav']>();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push(lp('/'));
    router.refresh();
  };

  const goToDashboard = () => {
    router.push(lp('/dashboard'));
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={goToDashboard}
        className="hidden h-10 px-4 sm:flex"
      >
        <LayoutDashboard className="mr-2 h-4 w-4" />
        {t('goToDashboard')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <Avatar>
              <AvatarImage src={user.user_metadata.avatar_url} alt="User" />
              <AvatarFallback>{user.email?.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.user_metadata?.full_name || user.email}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <DropdownMenuItem onClick={goToDashboard} className="sm:hidden">
            <LayoutDashboard className="mr-2 h-4 w-4" />
            {t('goToDashboard')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
