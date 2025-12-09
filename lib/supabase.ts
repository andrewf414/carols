import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type User = {
  id: string;
  username: string;
  is_admin: boolean;
  created_at: string;
};

export type Thread = {
  id: string;
  name: string;
  created_at: string;
  created_by: string | null;
};

export type Message = {
  id: string;
  thread_id: string;
  user_id: string;
  content: string;
  created_at: string;
  users?: User;
};
