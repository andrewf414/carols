import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase, Thread, Message, User } from '../lib/supabase';
import styles from '../styles/Chat.module.css';

export default function Chat() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [showCreateThread, setShowCreateThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState('');
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string>('');
  const [initializingThreads, setInitializingThreads] = useState(false);
  const [typingUsers, setTypingUsers] = useState<{ [key: string]: string[] }>({});
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [showUserList, setShowUserList] = useState(false);
  const [showEditUsername, setShowEditUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [unreadCounts, setUnreadCounts] = useState<{ [threadId: string]: number }>({});
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingChannelRef = useRef<any>(null);
  const presenceChannelRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const MAX_MESSAGE_LENGTH = 1000; // About 150-200 words

  useEffect(() => {
    // Check authentication
    const storedUserId = localStorage.getItem('userId');
    const storedUsername = localStorage.getItem('username');

    if (!storedUserId || !storedUsername) {
      router.push('/');
      return;
    }

    setUserId(storedUserId);
    setUsername(storedUsername);

    // Fetch fresh user data from Supabase to get current admin status
    const fetchUserData = async () => {
      const { data, error } = await supabase
        .from('users')
        .select('is_admin')
        .eq('id', storedUserId)
        .single();

      if (data) {
        setIsAdmin(data.is_admin);
        localStorage.setItem('isAdmin', data.is_admin.toString());
      }
    };

    fetchUserData();

    // Load threads
    loadThreads();

    // Setup presence (online users)
    const presenceChannel = supabase.channel('online-users');
    
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const users = Object.values(state)
          .flat()
          .map((presence: any) => presence.username)
          .filter((name, index, self) => self.indexOf(name) === index); // Remove duplicates
        setOnlineUsers(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            userId: storedUserId,
            username: storedUsername,
            online_at: new Date().toISOString(),
          });
        }
      });

    presenceChannelRef.current = presenceChannel;

    // Subscribe to thread changes
    const threadsSubscription = supabase
      .channel('threads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, () => {
        loadThreads();
      })
      .subscribe();

    // Subscribe to all messages for unread count updates
    const allMessagesSubscription = supabase
      .channel('all-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMessage = payload.new as any;
        // If message is in a non-selected thread and from another user, increment unread
        if (newMessage.thread_id !== selectedThread?.id && newMessage.user_id !== storedUserId) {
          setUnreadCounts(prev => ({
            ...prev,
            [newMessage.thread_id]: (prev[newMessage.thread_id] || 0) + 1
          }));
        }
      })
      .subscribe();

    return () => {
      threadsSubscription.unsubscribe();
      allMessagesSubscription.unsubscribe();
      if (presenceChannelRef.current) {
        presenceChannelRef.current.unsubscribe();
      }
    };
  }, [router]);

  useEffect(() => {
    if (!selectedThread) return;

    // Load messages for selected thread
    loadMessages(selectedThread.id);

    // Subscribe to new messages
    const messagesSubscription = supabase
      .channel(`messages:${selectedThread.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${selectedThread.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          loadMessages(selectedThread.id); // Reload to get user info
          // If message is from another user, it's unread until we mark as viewed
          if (newMessage.user_id !== userId) {
            setUnreadCounts(prev => ({ ...prev, [selectedThread.id]: (prev[selectedThread.id] || 0) + 1 }));
          }
        }
      )
      .subscribe();

    // Subscribe to typing indicators for this thread
    const typingChannel = supabase.channel(`typing:${selectedThread.id}`);
    
    typingChannel
      .on('broadcast', { event: 'typing' }, (payload: any) => {
        const { userId: typingUserId, username: typingUsername, isTyping } = payload.payload;
        
        setTypingUsers((prev) => {
          const threadTyping = prev[selectedThread.id] || [];
          if (isTyping) {
            // Add user if not already in list
            if (!threadTyping.includes(typingUsername)) {
              return {
                ...prev,
                [selectedThread.id]: [...threadTyping, typingUsername],
              };
            }
          } else {
            // Remove user from list
            return {
              ...prev,
              [selectedThread.id]: threadTyping.filter((u) => u !== typingUsername),
            };
          }
          return prev;
        });

        // Auto-remove typing indicator after 6 seconds
        if (isTyping) {
          setTimeout(() => {
            setTypingUsers((prev) => {
              const threadTyping = prev[selectedThread.id] || [];
              return {
                ...prev,
                [selectedThread.id]: threadTyping.filter((u) => u !== typingUsername),
              };
            });
          }, 6000);
        }
      })
      .subscribe();

    typingChannelRef.current = typingChannel;

    return () => {
      messagesSubscription.unsubscribe();
      typingChannel.unsubscribe();
      typingChannelRef.current = null;
    };
  }, [selectedThread]);

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    // Scroll to bottom when thread is selected (after a short delay to ensure content is rendered)
    if (selectedThread) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 100);
    }
  }, [selectedThread]);

  const loadThreads = async () => {
    setLoadingThreads(true);
    setError('');
    const { data, error } = await supabase
      .from('threads')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading threads:', error);
      setError('Failed to load threads. Please check your connection.');
      setLoadingThreads(false);
      return;
    }

    setThreads(data || []);
    setLoadingThreads(false);

    // Auto-select first thread if none selected
    if (data && data.length > 0 && !selectedThread) {
      setSelectedThread(data[0]);
    }
    
    // Load unread counts for all threads
    if (data && data.length > 0) {
      loadUnreadCounts(data.map(t => t.id));
    }
  };

  const loadUnreadCounts = async (threadIds: string[]) => {
    if (!userId) return;

    const counts: { [threadId: string]: number } = {};

    for (const threadId of threadIds) {
      // Get last viewed time for this thread
      const { data: viewData } = await supabase
        .from('thread_views')
        .select('last_viewed_at')
        .eq('user_id', userId)
        .eq('thread_id', threadId)
        .single();

      if (viewData?.last_viewed_at) {
        // Count messages after last viewed time
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('thread_id', threadId)
          .gt('created_at', viewData.last_viewed_at);

        counts[threadId] = count || 0;
      } else {
        // Never viewed - count all messages
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('thread_id', threadId);

        counts[threadId] = count || 0;
      }
    }

    setUnreadCounts(counts);
  };

  const loadMessages = async (threadId: string) => {
    setLoadingMessages(true);
    setError('');
    const { data, error } = await supabase
      .from('messages')
      .select('*, users(username)')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading messages:', error);
      setError('Failed to load messages. Please check your connection.');
      setLoadingMessages(false);
      return;
    }

    setMessages(data || []);
    setLoadingMessages(false);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedThread) return;

    // Stop typing indicator
    broadcastTyping(false);

    const { error } = await supabase.from('messages').insert({
      thread_id: selectedThread.id,
      user_id: userId,
      content: messageInput.trim(),
    });

    if (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message');
      return;
    }

    setMessageInput('');
  };

  const broadcastTyping = (isTyping: boolean) => {
    if (!selectedThread || !typingChannelRef.current) return;

    typingChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId, username, isTyping },
    });
  };

  const handleTyping = () => {
    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Broadcast that user is typing
    broadcastTyping(true);

    // Set timeout to stop typing indicator after 5 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      broadcastTyping(false);
    }, 5000);
  };

  const createThread = async () => {
    if (!newThreadName.trim()) return;

    const { error } = await supabase.from('threads').insert({
      name: newThreadName.trim(),
      created_by: userId,
    });

    if (error) {
      console.error('Error creating thread:', error);
      alert('Failed to create thread');
      return;
    }

    setNewThreadName('');
    setShowCreateThread(false);
  };

  const deleteThread = async (threadId: string, threadName: string) => {
    if (!confirm(`Are you sure you want to delete "${threadName}"? This will delete all messages in this thread.`)) {
      return;
    }

    const { error } = await supabase.from('threads').delete().eq('id', threadId);

    if (error) {
      console.error('Error deleting thread:', error);
      alert('Failed to delete thread');
      return;
    }

    // If deleted thread was selected, clear selection
    if (selectedThread?.id === threadId) {
      setSelectedThread(threads.length > 1 ? threads[0] : null);
      setShowMobileChat(false);
    }
  };

  const initializeDefaultThreads = async () => {
    if (!confirm('This will create threads for all 2025 performers plus a General thread. Continue?')) {
      return;
    }

    setInitializingThreads(true);

    try {
      const response = await fetch('/api/threads/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Failed to initialize threads');
        setInitializingThreads(false);
        return;
      }

      alert(`Successfully created ${data.count} threads!`);
      setInitializingThreads(false);
      // Threads will auto-reload via subscription
    } catch (err) {
      alert('Something went wrong. Please try again.');
      setInitializingThreads(false);
    }
  };

  const selectThread = (thread: Thread) => {
    setSelectedThread(thread);
    setShowMobileChat(true);
    markThreadAsViewed(thread.id);
  };

  const markThreadAsViewed = async (threadId: string) => {
    if (!userId) return;

    // Upsert thread view record
    await supabase
      .from('thread_views')
      .upsert(
        { user_id: userId, thread_id: threadId, last_viewed_at: new Date().toISOString() },
        { onConflict: 'user_id,thread_id' }
      );

    // Clear unread count for this thread
    setUnreadCounts(prev => ({ ...prev, [threadId]: 0 }));
  };

  const backToThreads = () => {
    setShowMobileChat(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('isAdmin');
    router.push('/');
  };

  const handleEditUsername = async () => {
    if (!newUsername.trim() || newUsername.trim().length < 2) {
      alert('Username must be at least 2 characters');
      return;
    }

    try {
      const response = await fetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, newUsername: newUsername.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Failed to update username');
        return;
      }

      // Update local state and storage
      setUsername(data.username);
      localStorage.setItem('username', data.username);
      
      // Update presence with new username
      if (presenceChannelRef.current) {
        await presenceChannelRef.current.track({
          userId: userId,
          username: data.username,
          online_at: new Date().toISOString(),
        });
      }

      setShowEditUsername(false);
      setNewUsername('');
    } catch (err) {
      alert('Failed to update username. Please try again.');
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    const daysDiff = Math.floor((today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24));
    
    const timeString = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    
    if (daysDiff === 0) {
      // Today - just show time
      return timeString;
    } else if (daysDiff === 1) {
      // Yesterday
      return `Yesterday ${timeString}`;
    } else if (daysDiff < 7) {
      // Within a week - show day name
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      return `${dayName} ${timeString}`;
    } else {
      // Older - show full date
      const dateString = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${dateString} ${timeString}`;
    }
  };

  return (
    <div className={styles.container}>
      <Head>
        <title>Carols Chat</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      <div className={styles.header}>
        <div className={styles.headerTitle}>🎄 Carols Chat</div>
        <div className={styles.userInfo}>
          <button 
            onClick={() => setShowUserList(!showUserList)} 
            className={styles.userListButton}
            title="View online users"
          >
            👥 {onlineUsers.length}
          </button>
          {username} {isAdmin && '(Admin)'} • 
          <button onClick={() => {
            setNewUsername(username);
            setShowEditUsername(true);
          }} style={{ background: 'none', border: 'none', color: '#ffd700', cursor: 'pointer', textDecoration: 'underline' }}>
            Edit
          </button> • 
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#0070f3', cursor: 'pointer' }}>Logout</button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          {error}
          <button onClick={() => setError('')} className={styles.errorClose}>×</button>
        </div>
      )}

      {showUserList && (
        <div className={styles.userListPanel}>
          <div className={styles.userListHeader}>
            <span>Online Users ({onlineUsers.length})</span>
            <button onClick={() => setShowUserList(false)} className={styles.userListClose}>×</button>
          </div>
          <div className={styles.userListContent}>
            {onlineUsers.map((user) => (
              <div key={user} className={styles.userListItem}>
                <span className={styles.onlineDot}></span>
                {user}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.mainContent}>
        {/* Threads Panel */}
        <div className={`${styles.threadsPanel} ${showMobileChat ? styles.threadsPanelHidden : ''}`}>
          <div className={styles.threadsList}>
            {loadingThreads ? (
              <div className={styles.loadingState}>
                <div className={styles.spinner}></div>
                <div>Loading threads...</div>
              </div>
            ) : threads.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>💬</div>
                <div className={styles.emptyStateTitle}>No threads yet</div>
                <div className={styles.emptyStateText}>
                  {isAdmin ? 'Create a thread to get started!' : 'An admin will create threads soon.'}
                </div>
              </div>
            ) : (
              threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`${styles.threadItem} ${selectedThread?.id === thread.id ? styles.threadItemActive : ''}`}
                >
                  <div onClick={() => selectThread(thread)} style={{ flex: 1, cursor: 'pointer' }}>
                    <div className={styles.threadName}>
                      {thread.name}
                      {unreadCounts[thread.id] > 0 && (
                        <span className={styles.unreadBadge}>{unreadCounts[thread.id]}</span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      className={styles.deleteThreadButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteThread(thread.id, thread.name);
                      }}
                      title="Delete thread"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {isAdmin && (
            <div className={styles.adminControls}>
              <button className={`${styles.primaryButton} ${styles.adminButton}`} onClick={() => setShowCreateThread(true)}>
                + Create Thread
              </button>
              {threads.length === 0 && (
                <button 
                  className={`${styles.primaryButton} ${styles.adminButton} ${styles.adminButtonSecondary}`} 
                  onClick={initializeDefaultThreads}
                  disabled={initializingThreads}
                  style={{ marginTop: '0.5rem' }}
                >
                  {initializingThreads ? 'Setting up...' : 'Setup 2025 Performers'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Chat Panel */}
        <div className={`${styles.chatPanel} ${showMobileChat ? styles.chatPanelActive : ''}`}>
          {selectedThread ? (
            <>
              <div className={styles.chatHeader}>
                <button className={styles.backButton} onClick={backToThreads}>
                  ←
                </button>
                <div className={styles.chatHeaderTitle}>{selectedThread.name}</div>
              </div>

              <div className={styles.messagesContainer}>
                {loadingMessages ? (
                  <div className={styles.loadingState}>
                    <div className={styles.spinner}></div>
                    <div>Loading messages...</div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyStateIcon}>🎄</div>
                    <div className={styles.emptyStateTitle}>No messages yet</div>
                    <div className={styles.emptyStateText}>Be the first to send a message!</div>
                  </div>
                ) : (
                  <>
                    {messages.map((message) => (
                      <div key={message.id} className={styles.message}>
                        <div className={styles.messageHeader}>
                          <span className={styles.messageUsername}>
                            {(message.users as any)?.username || 'Unknown'}
                          </span>
                          <span className={styles.messageTime}>{formatTime(message.created_at)}</span>
                        </div>
                        <div className={styles.messageContent}>{message.content}</div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {selectedThread && typingUsers[selectedThread.id] && typingUsers[selectedThread.id].length > 0 && (
                <div className={styles.typingIndicator}>
                  <div className={styles.typingDots}>
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <span className={styles.typingText}>
                    {typingUsers[selectedThread.id].length === 1
                      ? `${typingUsers[selectedThread.id][0]} is typing...`
                      : typingUsers[selectedThread.id].length === 2
                      ? `${typingUsers[selectedThread.id][0]} and ${typingUsers[selectedThread.id][1]} are typing...`
                      : `${typingUsers[selectedThread.id].length} people are typing...`}
                  </span>
                </div>
              )}

              <div className={styles.messageInput}>
                <form onSubmit={sendMessage} className={styles.messageForm}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <textarea
                      value={messageInput}
                      onChange={(e) => {
                        setMessageInput(e.target.value);
                        handleTyping();
                      }}
                      placeholder="Type a message..."
                      className={styles.messageTextarea}
                      rows={1}
                      maxLength={MAX_MESSAGE_LENGTH}
                      onFocus={(e) => {
                        // Scroll textarea into view when focused (for mobile keyboard)
                        setTimeout(() => {
                          e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 300);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage(e);
                        }
                      }}
                    />
                    <div className={styles.characterCount}>
                      {messageInput.length}/{MAX_MESSAGE_LENGTH}
                    </div>
                  </div>
                  <button type="submit" className={`${styles.primaryButton} ${styles.sendButton}`} disabled={!messageInput.trim()}>
                    Send
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
              Select a thread to start chatting
            </div>
          )}
        </div>
      </div>

      {/* Edit Username Modal */}
      {showEditUsername && (
        <div className={styles.modal} onClick={() => setShowEditUsername(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Edit Username</h2>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Enter new username"
              className={styles.modalInput}
              maxLength={30}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleEditUsername();
                }
              }}
            />
            <div className={styles.modalButtons}>
              <button
                className={`${styles.modalButton} ${styles.modalButtonSecondary}`}
                onClick={() => setShowEditUsername(false)}
              >
                Cancel
              </button>
              <button
                className={`${styles.modalButton} ${styles.modalButtonPrimary}`}
                onClick={handleEditUsername}
                disabled={!newUsername.trim() || newUsername.trim().length < 2}
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Thread Modal */}
      {showCreateThread && (
        <div className={styles.modal} onClick={() => setShowCreateThread(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Create New Thread</h2>
            <input
              type="text"
              value={newThreadName}
              onChange={(e) => setNewThreadName(e.target.value)}
              placeholder="Thread name (e.g., Performer Name)"
              className={styles.modalInput}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  createThread();
                }
              }}
            />
            <div className={styles.modalButtons}>
              <button
                className={`${styles.modalButton} ${styles.modalButtonSecondary}`}
                onClick={() => setShowCreateThread(false)}
              >
                Cancel
              </button>
              <button
                className={`${styles.modalButton} ${styles.modalButtonPrimary}`}
                onClick={createThread}
                disabled={!newThreadName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
