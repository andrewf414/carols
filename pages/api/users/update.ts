import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, newUsername } = req.body;

  if (!userId || !newUsername || typeof newUsername !== 'string') {
    return res.status(400).json({ error: 'User ID and new username are required' });
  }

  const trimmedUsername = newUsername.trim();

  if (trimmedUsername.length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters' });
  }

  try {
    // Update username
    const { data, error } = await supabase
      .from('users')
      .update({ username: trimmedUsername })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating username:', error);
      return res.status(500).json({ error: 'Failed to update username' });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
