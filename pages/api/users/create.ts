import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username } = req.body;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  const trimmedUsername = username.trim();

  if (trimmedUsername.length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters' });
  }

  try {
    // Check if username already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, username, is_admin')
      .eq('username', trimmedUsername)
      .single();

    if (existingUser) {
      // Return existing user
      return res.status(200).json(existingUser);
    }

    // Create new user
    const { data, error } = await supabase
      .from('users')
      .insert({ username: trimmedUsername })
      .select()
      .single();

    if (error) {
      console.error('Error creating user:', error);
      return res.status(500).json({ error: 'Failed to create user' });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
