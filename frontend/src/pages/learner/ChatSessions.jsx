import { useState, useEffect, useRef } from 'react';
import Sidebar from '../../layout/Sidebar';
import Navbar from '../../layout/Navbar';
import axios from 'axios';
import AgoraRTC from 'agora-rtc-sdk-ng';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const AGORA_APP_ID = '9474adec4dbc415bac9980a3a5beae89';
const RAZORPAY_KEY = 'rzp_test_SPmp7NV9xRxWb8';

const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

// Proper Agora video player — uses useEffect to call play() after DOM mount
const RemoteVideoPlayer = ({ videoTrack, label }) => {
  const containerRef = useRef(null);
  useEffect(() => {
    if (videoTrack && containerRef.current) {
      videoTrack.play(containerRef.current);
    }
    return () => { videoTrack?.stop(); };
  }, [videoTrack]);
  return (
    <div className="w-full h-full bg-[#111114] rounded-[40px] overflow-hidden border border-white/5 shadow-2xl relative">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-6 left-6 flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
        <span className="text-white font-black text-[10px] uppercase tracking-wider">{label}</span>
      </div>
    </div>
  );
};

const LocalVideoPlayer = ({ videoTrack, label }) => {
  const containerRef = useRef(null);
  useEffect(() => {
    if (videoTrack && containerRef.current) {
      videoTrack.play(containerRef.current);
    }
    return () => { videoTrack?.stop(); };
  }, [videoTrack]);
  return (
    <div className="w-full h-full bg-[#111114] rounded-[40px] overflow-hidden border border-white/5 shadow-2xl relative">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-6 left-6 flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
        <div className="w-2 h-2 bg-indigo-500 rounded-full" />
        <span className="text-white font-black text-[10px] uppercase tracking-wider">{label}</span>
      </div>
    </div>
  );
};

const LearnerChatSessions = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [localAudioTrack, setLocalAudioTrack] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const audioTracksRef = useRef({});
  const messagesEndRef = useRef(null);
  const localVideoTrackRef = useRef(null);
  const localAudioTrackRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, { transports: ['websocket'] });
    return () => socketRef.current?.disconnect();
  }, []);

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const res = await axios.get(`${SOCKET_URL}/api/chat/conversations`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setConversations(res.data);
        if (res.data.length > 0) setActiveConv(res.data[0]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (token) fetchConversations();
  }, [token]);

  useEffect(() => {
    if (!activeConv || !socketRef.current) return;
    const fetchMessages = async () => {
      try {
        const res = await axios.get(`${SOCKET_URL}/api/chat/${activeConv._id}/messages`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setMessages(res.data);
      } catch (err) { console.error(err); }
    };
    fetchMessages();
    socketRef.current.emit('join_room', activeConv._id);
    const handleReceive = (msg) => {
      setMessages(prev => prev.some(m => m._id === msg._id) ? prev : [...prev, msg]);
    };
    socketRef.current.on('receive_message', handleReceive);
    // Listen for completion status updates from tutor
    socketRef.current.on('status_updated', ({ requestId, status }) => {
       if (activeConv?._id === requestId) {
         setActiveConv(prev => ({ ...prev, paymentStatus: status }));
         setConversations(prev => prev.map(c => c._id === requestId ? { ...c, paymentStatus: status } : c));
       }
    });
    return () => {
      socketRef.current.off('receive_message', handleReceive);
      socketRef.current.off('status_updated');
    };
  }, [activeConv, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeConv || sending) return;
    setSending(true);
    try {
      const res = await axios.post(
        `${SOCKET_URL}/api/chat/${activeConv._id}/messages`,
        { content: input.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      socketRef.current.emit('send_message', { requestId: activeConv._id, message: res.data });
      setMessages(prev => [...prev, res.data]);
      setInput('');
    } catch (err) { console.error(err); }
    finally { setSending(false); }
  };

  const handleMakePayment = async () => {
    if (!activeConv) return;
    const amount = activeConv.totalBill || activeConv.budget || 500;
    try {
      const orderRes = await axios.post(`${SOCKET_URL}/api/payments/initiate`,
        { amount, receipt: `receipt_${activeConv._id}` },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const order = orderRes.data;

      const options = {
        key: RAZORPAY_KEY,
        amount: order.amount,
        currency: order.currency,
        name: 'GigSpark Escrow',
        description: `Funds held for: ${activeConv.skillName}`,
        order_id: order.id,
        handler: async (response) => {
          try {
            await axios.post(`${SOCKET_URL}/api/payments/verify`,
              { ...response, requestId: activeConv._id },
              { headers: { Authorization: `Bearer ${token}` } }
            );
            setConversations(prev => prev.map(c =>
              c._id === activeConv._id ? { ...c, paymentPaid: true, paymentStatus: 'held' } : c
            ));
            setActiveConv(prev => ({ ...prev, paymentPaid: true, paymentStatus: 'held' }));
          } catch (err) {
            alert('Payment verification failed');
          }
        },
        prefill: { name: user?.name, email: user?.email },
        theme: { color: '#4f46e5' },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      alert('Payment initiation failed: ' + err.message);
    }
  };

  const handleConfirmCompletion = async () => {
    if (!activeConv || confirming) return;
    setConfirming(true);
    try {
      await axios.put(`${SOCKET_URL}/api/payments/confirm-completion/${activeConv._id}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      socketRef.current.emit('payment_status_change', { requestId: activeConv._id, status: 'released' });
      setActiveConv(prev => ({ ...prev, paymentStatus: 'released' }));
      setConversations(prev => prev.map(c => c._id === activeConv._id ? { ...c, paymentStatus: 'released' } : c));
      alert('Payment confirmed and released! Redirecting to rate your tutor...');
      
      // Navigate to rating page
      const tutorId = activeConv.tutor?._id || activeConv.tutor?.id;
      if (tutorId) {
        navigate(`/learner/rate/${tutorId}`);
      } else {
        alert('Thank you for your feedback!');
      }
    } catch (err) {
      console.error('Confirm completion error:', err);
      alert('Error releasing funds');
    } finally {
      setConfirming(false);
    }
  };

  const handleDeclineCompletion = async () => {
    if (!activeConv || confirming) return;
    setConfirming(true); // Using same loading state to disable both buttons
    try {
      await axios.put(`${SOCKET_URL}/api/payments/decline-completion/${activeConv._id}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      socketRef.current.emit('payment_status_change', { requestId: activeConv._id, status: 'declined' });
      setActiveConv(prev => ({ ...prev, paymentStatus: 'declined' }));
      setConversations(prev => prev.map(c => c._id === activeConv._id ? { ...c, paymentStatus: 'declined' } : c));
      alert('Completion request declined.');
    } catch (err) {
      console.error('Decline completion error:', err);
      alert('Error declining request');
    } finally {
      setConfirming(false);
    }
  };

  const toggleMute = async () => {
    if (localAudioTrack) {
      await localAudioTrack.setMuted(!isMuted);
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = async () => {
    if (localVideoTrack) {
      await localVideoTrack.setEnabled(isVideoOff);
      setIsVideoOff(!isVideoOff);
    }
  };

  const handleJoinCall = async () => {
    if (activeConv?.paymentStatus === 'none') {
      alert('Please make an upfront payment to join the session.');
      return;
    }
    try {
      const res = await axios.post(`${SOCKET_URL}/api/sessions/agora-token`,
        { channelName: `request_${activeConv._id}` },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const { token: agoraToken } = res.data;
      agoraClient.on('user-published', async (remoteUser, mediaType) => {
        await agoraClient.subscribe(remoteUser, mediaType);
        if (mediaType === 'video') {
          setRemoteUsers(prev => {
            const exists = prev.find(u => u.uid === remoteUser.uid);
            return exists
              ? prev.map(u => u.uid === remoteUser.uid ? remoteUser : u)
              : [...prev, remoteUser];
          });
        }
        if (mediaType === 'audio') {
          audioTracksRef.current[remoteUser.uid] = remoteUser.audioTrack;
          remoteUser.audioTrack?.play();
        }
      });
      agoraClient.on('user-unpublished', (remoteUser, mediaType) => {
        if (mediaType === 'video') setRemoteUsers(prev => prev.filter(u => u.uid !== remoteUser.uid));
        if (mediaType === 'audio') {
          audioTracksRef.current[remoteUser.uid]?.stop();
          delete audioTracksRef.current[remoteUser.uid];
        }
      });

      await agoraClient.join(AGORA_APP_ID, `request_${activeConv._id}`, agoraToken, null);
      const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      setLocalVideoTrack(videoTrack);
      setLocalAudioTrack(audioTrack);
      localVideoTrackRef.current = videoTrack;
      localAudioTrackRef.current = audioTrack;
      await agoraClient.publish([audioTrack, videoTrack]);
      setInCall(true);
      setIsMuted(false);
      setIsVideoOff(false);
    } catch (err) {
      console.error('Join call error:', err);
      alert('Could not join call. Please check camera/microphone permissions.');
    }
  };

  useEffect(() => {
    return () => {
      // Emergency cleanup on unmount
      if (localVideoTrackRef.current) {
        localVideoTrackRef.current.stop();
        localVideoTrackRef.current.close();
      }
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current.close();
      }
      agoraClient.leave();
    };
  }, []);

  const handleLeaveCall = async () => {
    try {
      if (localVideoTrack) {
        localVideoTrack.stop();
        localVideoTrack.close();
      }
      if (localAudioTrack) {
        localAudioTrack.stop();
        localAudioTrack.close();
      }
      Object.values(audioTracksRef.current).forEach(t => t?.stop());
      audioTracksRef.current = {};
      await agoraClient.leave();
    } catch (err) {
      console.error('Error leaving call:', err);
    } finally {
      setInCall(false);
      setLocalVideoTrack(null);
      setLocalAudioTrack(null);
      localVideoTrackRef.current = null;
      localAudioTrackRef.current = null;
      setRemoteUsers([]);
      
      // Redirect to dashboard/rating after session
      if (activeConv?.tutor?._id) {
        navigate('/learner/dashboard'); // Navigating to dashboard as requested, rating can be handled separately if needed
      } else {
        navigate('/learner/dashboard');
      }
    }
  };

  const getOtherUser = (conv) => conv.tutor;
  const formatTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const myId = user?._id || user?.id;

  if (inCall) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0c] z-50 flex flex-col font-sans overflow-hidden">
        {/* Dark Header */}
        {!isFullScreen && (
          <div className="flex items-center justify-between px-10 py-6 border-b border-white/5 bg-black/40 backdrop-blur-xl shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                 <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              </div>
              <div>
                <h2 className="text-white font-black text-xl tracking-tight">Session with {getOtherUser(activeConv)?.name}</h2>
                <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.2em] mt-0.5">{activeConv?.skillName}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {activeConv?.paymentStatus === 'completion_requested' && (
                <div className="flex gap-2">
                  <button 
                    onClick={handleConfirmCompletion} 
                    disabled={confirming}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-2xl font-black text-xs transition-all shadow-xl shadow-emerald-500/20 active:scale-95 disabled:opacity-50 uppercase tracking-widest"
                  >
                    {confirming ? 'Confirming...' : 'Release Payment'}
                  </button>
                  <button 
                    onClick={handleDeclineCompletion} 
                    disabled={confirming}
                    className="bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white px-8 py-3 rounded-2xl font-black text-[10px] transition-all border border-rose-500/20 hover:border-rose-600 shadow-xl active:scale-95 disabled:opacity-50 uppercase tracking-widest"
                  >
                    {confirming ? 'Wait...' : 'Decline'}
                  </button>
                </div>
              )}
              <button onClick={handleLeaveCall} className="bg-rose-600 hover:bg-rose-700 text-white px-8 py-3 rounded-2xl font-black text-xs transition-all shadow-xl shadow-rose-500/20 active:scale-95 uppercase tracking-widest">
                End Session
              </button>
            </div>
          </div>
        )}

        {/* Video Stage */}
        <div className="flex-1 relative bg-black flex items-center justify-center p-6">
          {/* Main Remote Video (Tutor) */}
          <div className={`relative transition-all duration-700 ease-in-out ${isFullScreen ? 'w-full h-full p-0' : 'w-full max-w-6xl aspect-video rounded-[40px] shadow-2xl shadow-indigo-500/10 overflow-hidden'}`}>
            {remoteUsers.length > 0 ? (
              <RemoteVideoPlayer
                videoTrack={remoteUsers[0].videoTrack}
                label={`${getOtherUser(activeConv)?.name || 'Tutor'} (Tutor)`}
              />
            ) : (
              <div className="w-full h-full bg-[#111114] flex flex-col items-center justify-center gap-4">
                <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center animate-pulse">
                  <span className="text-white/20 font-black text-2xl">{getOtherUser(activeConv)?.name?.[0]}</span>
                </div>
                <p className="text-white/20 font-black text-sm uppercase tracking-widest">Waiting for tutor...</p>
              </div>
            )}

            {/* Full Screen Toggle Overlay */}
            <button 
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="absolute top-8 right-8 w-12 h-12 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-black/60 transition-all z-10"
            >
              {isFullScreen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 9L4 4m0 0l4.553-2.069A1 1 0 0110 2.82v6.36a1 1 0 01-1.447.894L4 8" /></svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              )}
            </button>
          </div>

          {/* Local PiP Video Track (You) */}
          <div className={`absolute transition-all duration-500 ${isFullScreen ? 'bottom-10 right-10 w-64 h-40' : 'bottom-12 right-12 w-64 h-40'} z-20 group`}>
            <div className="w-full h-full rounded-3xl overflow-hidden shadow-2xl border-2 border-white/10 bg-[#111114] hover:scale-105 transition-transform">
               <LocalVideoPlayer videoTrack={localVideoTrack} label="You" />
            </div>
          </div>
        </div>

        {/* Floating Controls Overlay */}
        <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/60 backdrop-blur-2xl border border-white/10 px-8 py-5 rounded-[2.5rem] z-30 transition-all ${isFullScreen ? 'opacity-0 hover:opacity-100' : 'opacity-100'}`}>
           <button 
             onClick={toggleMute}
             className={`px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${isMuted ? 'bg-rose-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
           >
              {isMuted ? 'Unmute' : 'Mute'}
           </button>
           
           <button 
             onClick={toggleVideo}
             className={`px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${isVideoOff ? 'bg-rose-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
           >
              {isVideoOff ? 'Start Video' : 'Stop Video'}
           </button>

           <button 
             onClick={handleLeaveCall} 
             className="px-8 py-3 rounded-2xl bg-rose-600 text-white font-black text-[10px] uppercase tracking-widest hover:bg-rose-700 transition-all shadow-xl shadow-rose-500/20"
           >
              Exit Session
           </button>

           {activeConv?.paymentStatus === 'completion_requested' && isFullScreen && (
              <button 
                onClick={handleConfirmCompletion} 
                disabled={confirming} 
                className="px-6 py-3 bg-emerald-600 rounded-2xl text-white font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50"
              >
                {confirming ? '...' : 'Release'}
              </button>
           )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#fcfcfd]">
      <Sidebar />
      <div className="flex-1 ml-72 flex flex-col" style={{ height: '100vh' }}>
        <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
          <div className="w-80 bg-white border-r border-gray-100 flex flex-col flex-shrink-0 shadow-sm">
            <div className="px-8 py-6 border-b border-gray-50">
              <h3 className="font-extrabold text-gray-900 text-lg tracking-tight">Messages</h3>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {loading ? (
                <div className="p-4 space-y-3">{[1,2,3].map(i => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                    <div className="w-12 h-12 bg-gray-100 rounded-2xl flex-shrink-0" />
                    <div className="flex-1 space-y-2 text-indigo-700 font-bold">Loading...</div>
                  </div>
                ))}</div>
              ) : conversations.map(conv => {
                const other = getOtherUser(conv);
                const isActive = activeConv?._id === conv._id;
                return (
                  <button key={conv._id} onClick={() => { setActiveConv(conv); setMessages([]); }}
                    className={`w-full flex items-center gap-4 px-6 py-5 text-left border-b border-gray-50 transition-all relative ${isActive ? 'bg-indigo-50/40' : 'hover:bg-gray-50/50'}`}>
                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-600 rounded-r-full" />}
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow-lg shadow-indigo-100 uppercase overflow-hidden">
                      {other?.profilePhoto ? <img src={other.profilePhoto} className="w-full h-full object-cover" alt={other.name} /> : (other?.name?.[0] || '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-black text-sm truncate ${isActive ? 'text-indigo-900' : 'text-gray-800'}`}>{other?.name}</p>
                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest truncate">{conv.skillName}</p>
                    </div>
                    {conv.paymentStatus === 'held' && <div className="w-2 h-2 bg-emerald-400 rounded-full" />}
                    {conv.paymentStatus === 'released' && <div className="w-2 h-2 bg-emerald-400 rounded-full" />}
                  </button>
                );
              })}
            </div>
          </div>

          {activeConv ? (
            <div className="flex-1 flex flex-col bg-white">
              <div className="bg-white border-b border-gray-100 px-8 py-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-xl shadow-indigo-100 uppercase overflow-hidden">
                     {getOtherUser(activeConv)?.name?.[0] || '?'}
                  </div>
                  <div>
                    <p className="font-black text-gray-900 text-base tracking-tight">{getOtherUser(activeConv)?.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-500 px-3 py-1 rounded-lg">{activeConv.skillName}</span>
                      {(activeConv.paymentStatus === 'held' || activeConv.paymentStatus === 'released' || activeConv.paymentStatus === 'completion_requested') && 
                        <span className="text-[9px] font-black bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-1.5">
                          <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                          Paid
                        </span>
                      }
                      {activeConv.paymentStatus === 'completion_requested' && (
                        <span className="text-[9px] font-black bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-1.5 animate-pulse">
                          <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
                          Action Required
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {activeConv.paymentStatus === 'none' && (
                    <button onClick={handleMakePayment} className="flex items-center gap-2.5 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl font-black text-xs transition-all uppercase tracking-widest shadow-xl shadow-indigo-100">
                      Pay ₹{activeConv.totalBill || activeConv.budget || 500}
                    </button>
                  )}
                  <button onClick={() => navigate('/learner/video', { state: { session: activeConv } })} disabled={activeConv.paymentStatus === 'none'}
                    className={`flex items-center gap-2.5 px-6 py-3 rounded-2xl font-black text-xs transition-all uppercase tracking-widest shadow-xl ${activeConv.paymentStatus !== 'none' ? 'bg-black text-white shadow-gray-200 hover:scale-105 active:scale-95' : 'bg-gray-100 text-gray-300 cursor-not-allowed shadow-none'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    Join Session
                  </button>
                </div>
              </div>


              <div className="flex-1 flex flex-col relative overflow-hidden">

                <div className="flex-1 overflow-y-auto px-10 py-8 space-y-6 bg-gray-50/30 custom-scrollbar">
                {messages.map((msg, i) => {
                  const isMe = String(msg.sender?._id || msg.sender) === String(myId);
                  return (
                    <div key={msg._id || i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`px-6 py-4 max-w-md text-sm font-semibold leading-relaxed shadow-sm ${isMe ? 'bg-indigo-600 text-white rounded-[26px] rounded-br-md shadow-indigo-100' : 'bg-white text-gray-800 rounded-[26px] rounded-bl-md border border-gray-100'}`}>
                        {msg.content}
                        <p className={`text-[10px] mt-2 font-bold opacity-40 ${isMe ? 'text-right' : 'text-left'}`}>{formatTime(msg.createdAt)}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>

              <div className="bg-white border-t border-gray-100 px-8 py-5">
                <form onSubmit={handleSend} className="flex items-center gap-4 bg-gray-50 border border-gray-100 p-2 rounded-[24px] focus-within:border-indigo-200 focus-within:ring-4 focus-within:ring-indigo-50 transition-all">
                  <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your message..." className="flex-1 bg-transparent px-4 py-2.5 text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-300" />
                  <button type="submit" disabled={!input.trim() || sending} className="w-11 h-11 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 hover:scale-105 active:scale-95 transition-all disabled:opacity-50">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50/40 gap-6">
                <div className="w-24 h-24 rounded-[32px] bg-white border border-gray-100 shadow-sm flex items-center justify-center">
                   <svg className="w-10 h-10 text-indigo-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>
                </div>
                <div className="text-center px-6">
                  <h4 className="text-gray-900 font-extrabold text-lg">Select a conversation</h4>
                  <p className="text-gray-400 text-sm font-medium mt-1">Pick a tutor from the list to start your session</p>
                </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LearnerChatSessions;


