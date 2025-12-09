import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase';

const DEFAULT_THREADS = [
  'General',
  'Tim Campbell',
  'Casey Donovan',
  'David Hobson',
  'Dami Im',
  'Andy Karl',
  'Elise McCann',
  'Rob Mills',
  'Silvie Paladino',
  'Paulini',
  'Michael Paynter',
  'Marina Prior',
  'Denis Walter',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Check if user is admin
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', userId)
      .single();

    if (userError || !user?.is_admin) {
      return res.status(403).json({ error: 'Only admins can initialize threads' });
    }

    // Check if threads already exist
    const { data: existingThreads, error: checkError } = await supabase
      .from('threads')
      .select('id')
      .limit(1);

    if (checkError) {
      console.error('Error checking threads:', checkError);
      return res.status(500).json({ error: 'Failed to check existing threads' });
    }

    if (existingThreads && existingThreads.length > 0) {
      return res.status(400).json({ error: 'Threads already exist' });
    }

    // Create all default threads
    const threadsToCreate = DEFAULT_THREADS.map(name => ({
      name,
      created_by: userId,
    }));

    const { data, error } = await supabase
      .from('threads')
      .insert(threadsToCreate)
      .select();

    if (error) {
      console.error('Error creating threads:', error);
      return res.status(500).json({ error: 'Failed to create threads' });
    }

    return res.status(200).json({ 
      success: true, 
      count: data.length,
      threads: data 
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
