import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, 
  Users, 
  Copy, 
  Crown, 
  ArrowLeft,
  Paperclip
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { 
  getRoom, 
  getRoomMembers, 
  getMessages, 
  sendMessage, 
  joinRoom, 
  leaveRoom, 
  isRoomMember,
  type Room, 
  type RoomMember, 
  type Message 
} from '../lib/rooms';
import { uploadChatMedia } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import TopBar from '../components/TopBar';
import Sidebar from '../components/Sidebar';
import CreateRoomModal from '../components/CreateRoomModal';

const RoomPage: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load room data
  useEffect(() => {
    const loadRoomData = async () => {
      if (!roomId || !user) return;

      try {
        setLoading(true);
        const [roomData, membersData, messagesData, membershipStatus] = await Promise.all([
          getRoom(roomId),
          getRoomMembers(roomId),
          getMessages(roomId),
          isRoomMember(roomId)
        ]);

        if (!roomData) {
          toast({
            title: "Room not found",
            description: "This room doesn't exist or has been deleted.",
            variant: "destructive"
          });
          navigate('/home');
          return;
        }

        setRoom(roomData);
        setMembers(membersData);
        setMessages(messagesData);
        setIsMember(membershipStatus);
      } catch (error) {
        console.error('Error loading room data:', error);
        toast({
          title: "Error",
          description: "Failed to load room data.",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    loadRoomData();
  }, [roomId, user, navigate, toast]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!roomId || !isMember) return;

    // Subscribe to new messages
    const messagesChannel = supabase
      .channel(`messages-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${roomId}`
        },
        async (payload) => {
          const newMessage = payload.new as Message;
          
          // Fetch profile data for the message
          const { data: profileData } = await supabase
            .from('profiles')
            .select('full_name, avatar_url')
            .eq('id', newMessage.user_id)
            .single();

          setMessages(prev => [...prev, {
            ...newMessage,
            profile: profileData || undefined
          }]);
        }
      )
      .subscribe();

    // Subscribe to room member changes
    const membersChannel = supabase
      .channel(`members-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_members',
          filter: `room_id=eq.${roomId}`
        },
        async () => {
          // Reload members when changes occur
          const membersData = await getRoomMembers(roomId);
          setMembers(membersData);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(membersChannel);
    };
  }, [roomId, isMember]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !roomId || sendingMessage) return;

    try {
      setSendingMessage(true);
      const message = await sendMessage(roomId, newMessage);
      
      if (message) {
        setNewMessage('');
      } else {
        toast({
          title: "Error",
          description: "Failed to send message.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: "Error",
        description: "Failed to send message.",
        variant: "destructive"
      });
    } finally {
      setSendingMessage(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !roomId || !user) return;

    try {
      setUploadingFile(true);
      const fileUrl = await uploadChatMedia(file, roomId, user.id);
      
      if (fileUrl) {
        const message = await sendMessage(roomId, `📷 [Image](${fileUrl})`);
        if (!message) {
          toast({
            title: "Error",
            description: "Failed to send image.",
            variant: "destructive"
          });
        }
      }
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload image.",
        variant: "destructive"
      });
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleJoinRoom = async () => {
    if (!roomId) return;

    try {
      await joinRoom(roomId);
      setIsMember(true);
      toast({
        title: "Joined room!",
        description: "Welcome to the study room!"
      });
    } catch (error: any) {
      toast({
        title: "Failed to join",
        description: error.message || "Could not join the room.",
        variant: "destructive"
      });
    }
  };

  const handleLeaveRoom = async () => {
    if (!roomId) return;

    try {
      await leaveRoom(roomId);
      toast({
        title: "Left room",
        description: "You have left the study room."
      });
      navigate('/home');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to leave room.",
        variant: "destructive"
      });
    }
  };

  const handleCopyInvite = () => {
    const inviteUrl = window.location.href;
    navigator.clipboard.writeText(inviteUrl);
    toast({
      title: "Invite link copied!",
      description: "Share this link with your study buddies."
    });
  };

  const renderMessage = (message: Message) => {
    const isOwn = message.user_id === user?.id;
    const isImage = message.content.includes('[Image]');
    
    if (isImage) {
      const imageUrl = message.content.match(/\(([^)]+)\)/)?.[1];
      return (
        <motion.div
          key={message.id}
          initial={{ opacity: 0, x: isOwn ? 20 : -20 }}
          animate={{ opacity: 1, x: 0 }}
          className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-4`}
        >
          <div className={`max-w-xs lg:max-w-md ${isOwn ? 'bg-blue-500' : 'bg-white/20 dark:bg-gray-800/20'} rounded-2xl p-3 backdrop-blur-sm`}>
            {!isOwn && (
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                {message.profile?.full_name || 'Unknown'}
              </p>
            )}
            {imageUrl && (
              <img 
                src={imageUrl} 
                alt="Shared image" 
                className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => window.open(imageUrl, '_blank')}
              />
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {new Date(message.created_at).toLocaleTimeString()}
            </p>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        key={message.id}
        initial={{ opacity: 0, x: isOwn ? 20 : -20 }}
        animate={{ opacity: 1, x: 0 }}
        className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-4`}
      >
        <div className={`max-w-xs lg:max-w-md ${isOwn ? 'bg-blue-500 text-white' : 'bg-white/20 dark:bg-gray-800/20 text-gray-800 dark:text-gray-200'} rounded-2xl p-3 backdrop-blur-sm`}>
          {!isOwn && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
              {message.profile?.full_name || 'Unknown'}
            </p>
          )}
          <p className="text-sm break-words">{message.content}</p>
          <p className={`text-xs mt-1 ${isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
            {new Date(message.created_at).toLocaleTimeString()}
          </p>
        </div>
      </motion.div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div className="backdrop-blur-md bg-white/30 dark:bg-gray-900/30 rounded-3xl border border-white/20 dark:border-gray-700/20 shadow-lg p-8">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-400 mt-4">Loading room...</p>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div className="backdrop-blur-md bg-white/30 dark:bg-gray-900/30 rounded-3xl border border-white/20 dark:border-gray-700/20 shadow-lg p-8 text-center">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-4">Room not found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">This room doesn't exist or has been deleted.</p>
          <button
            onClick={() => navigate('/home')}
            className="px-6 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors"
          >
            Go back home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <TopBar onMenuClick={() => setSidebarOpen(true)} />
      
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)}
        onCreateRoom={() => setCreateRoomOpen(true)}
      />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Room Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="backdrop-blur-md bg-white/30 dark:bg-gray-900/30 rounded-3xl border border-white/20 dark:border-gray-700/20 shadow-lg p-6 mb-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/home')}
                className="p-2 hover:bg-white/20 dark:hover:bg-gray-800/20 rounded-xl transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">{room.name}</h1>
                <p className="text-gray-600 dark:text-gray-400">{room.subject}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <Users className="w-4 h-4" />
                <span>{members.length}/{room.max_members}</span>
              </div>
              
              <button
                onClick={handleCopyInvite}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl hover:bg-blue-500/30 dark:hover:bg-blue-500/20 transition-colors"
              >
                <Copy className="w-4 h-4" />
                <span className="hidden sm:inline">Invite</span>
              </button>
              
              {isMember && room.creator_id !== user?.id && (
                <button
                  onClick={handleLeaveRoom}
                  className="px-4 py-2 bg-red-500/20 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-500/30 dark:hover:bg-red-500/20 transition-colors"
                >
                  Leave
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {!isMember ? (
          /* Join Room Prompt */
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="backdrop-blur-md bg-white/30 dark:bg-gray-900/30 rounded-3xl border border-white/20 dark:border-gray-700/20 shadow-lg p-8 text-center"
          >
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-4">Join this study room?</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">{room.description}</p>
            <button
              onClick={handleJoinRoom}
              className="px-8 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl hover:shadow-lg transition-all duration-300"
            >
              Join Room
            </button>
          </motion.div>
        ) : (
          /* Chat Interface */
          <div className="grid lg:grid-cols-4 gap-6">
            {/* Messages Panel */}
            <div className="lg:col-span-3">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="backdrop-blur-md bg-white/30 dark:bg-gray-900/30 rounded-3xl border border-white/20 dark:border-gray-700/20 shadow-lg overflow-hidden"
                style={{ height: '600px' }}
              >
                {/* Messages */}
                <div className="h-full flex flex-col">
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <AnimatePresence>
                      {messages.map(renderMessage)}
                    </AnimatePresence>
                    <div ref={messagesEndRef} />
                  </div>
                  
                  {/* Message Input */}
                  <div className="p-6 border-t border-white/20 dark:border-gray-700/20">
                    <div className="flex items-center gap-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFile}
                        className="p-2 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors disabled:opacity-50"
                      >
                        {uploadingFile ? (
                          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Paperclip className="w-5 h-5" />
                        )}
                      </button>
                      
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder="Type your message..."
                        className="flex-1 px-4 py-3 bg-white/20 dark:bg-gray-800/20 border border-white/20 dark:border-gray-700/20 rounded-xl placeholder-gray-500 dark:placeholder-gray-400 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-transparent transition-all"
                      />
                      
                      <button
                        onClick={handleSendMessage}
                        disabled={sendingMessage || !newMessage.trim()}
                        className="p-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl hover:shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {sendingMessage ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Send className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Members Panel */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="backdrop-blur-md bg-white/30 dark:bg-gray-900/30 rounded-3xl border border-white/20 dark:border-gray-700/20 shadow-lg p-6"
            >
              <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-4">
                Members ({members.length})
              </h3>
              
              <div className="space-y-3">
                {members.map((member) => (
                  <motion.div
                    key={member.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-3 p-3 bg-white/20 dark:bg-gray-800/20 rounded-xl"
                  >
                    <img
                      src={member.profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.profile?.full_name || 'User')}&background=3b82f6&color=fff`}
                      alt={member.profile?.full_name || 'User'}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">
                        {member.profile?.full_name || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        @{member.profile?.username || 'unknown'}
                      </p>
                    </div>
                    {member.role === 'admin' && (
                      <Crown className="w-4 h-4 text-yellow-500" />
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </div>

      <CreateRoomModal
        isOpen={createRoomOpen}
        onClose={() => setCreateRoomOpen(false)}
        onSuccess={() => {
          setCreateRoomOpen(false);
          // Optionally refresh room data
        }}
      />
    </div>
  );
};

export default RoomPage;