import { Nav } from '@/components/nav';
import { getProfileActiveRole } from '@/database/queries/profiles';
import { createClient } from '@/database/server';

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The cart icon in <Nav> is hidden when active_role is PHOTOGRAPHER. Look it
  // up here (server) so the markup is decided before hydration — avoids a flash
  // of the cart icon on photographer accounts.
  const activeRole = user ? await getProfileActiveRole(supabase, user.id) : null;

  return <Nav user={user} activeRole={activeRole} />;
}
