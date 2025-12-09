import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import styles from '../styles/Login.module.css';

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if user already has a session
    const storedUserId = localStorage.getItem('userId');
    const storedUsername = localStorage.getItem('username');
    if (storedUserId && storedUsername) {
      router.push('/chat');
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    if (username.trim().length < 2) {
      setError('Username must be at least 2 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to create user');
        setLoading(false);
        return;
      }

      // Store user info in localStorage
      localStorage.setItem('userId', data.id);
      localStorage.setItem('username', data.username);
      localStorage.setItem('isAdmin', data.is_admin.toString());

      // Redirect to chat
      router.push('/chat');
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <Head>
        <title>Carols Chat - Login</title>
        <meta name="description" content="Join the Christmas Eve carols discussion" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className={styles.card}>
        <h1 className={styles.title}>🎄 Carols Chat</h1>
        <p className={styles.subtitle}>Join the Christmas Eve discussion</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div>
            <label htmlFor="username" className={styles.label}>
              Choose a username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your name"
              className={styles.input}
              maxLength={30}
              disabled={loading}
              autoFocus
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.button} disabled={loading}>
            {loading ? 'Joining...' : 'Join Chat'}
          </button>
        </form>
      </div>
    </div>
  );
}
