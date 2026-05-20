import { Nav } from '@/components/nav';
import { createClient } from '@/database/server';

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <Nav user={user} />;
}
