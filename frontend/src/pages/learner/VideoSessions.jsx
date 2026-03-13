import { useState, useEffect, useRef } from 'react';
import Sidebar from '../../layout/Sidebar';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';

const SOCKET_URL = 'http://localhost:5000';
const AGORA_APP_ID = '9474adec4dbc415bac9980a3a5beae89';

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

const VideoSessions = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [activeCall, setActiveCall] = useState(state?.session || null); 
  const [inCall, setInCall] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [localAudioTrack, setLocalAudioTrack] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [completionRequest, setCompletionRequest] = useState(null);
  const audioTracksRef = useRef({});
  const socketRef = useRef(null);
  const callContainerRef = useRef(null);
  
  const agoraClientRef = useRef(null);
  const localVideoTrackRef = useRef(null);
  const localAudioTrackRef = useRef(null);

  useEffect(() => {
    // Initialize Agora client if not exists
    if (!agoraClientRef.current) {
      agoraClientRef.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    }

    socketRef.current = io(SOCKET_URL, { transports: ['websocket'] });
    
    // Listen for tutor's session completion request
    socketRef.current.on('session_completion_requested', ({ requestId }) => {
      setCompletionRequest({ requestId });
    });

    return () => {
      socketRef.current?.disconnect();
      if (agoraClientRef.current) {
        agoraClientRef.current.removeAllListeners();
      }
    };
  }, []);

  useEffect(() => {
    if (activeCall && socketRef.current) {
      socketRef.current.emit('join_room', activeCall._id);
    }
  }, [activeCall]);


  const handleJoinSession = async (session) => {
    if (!agoraClientRef.current) return;
    try {
      const res = await axios.post(`${SOCKET_URL}/api/sessions/agora-token`,
        { channelName: `request_${session._id}` },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const { token: agoraToken } = res.data;

      // Clean listeners before joining
      agoraClientRef.current.removeAllListeners();

      agoraClientRef.current.on('user-published', async (remoteUser, mediaType) => {
        await agoraClientRef.current.subscribe(remoteUser, mediaType);
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
      agoraClientRef.current.on('user-unpublished', (remoteUser, mediaType) => {
        if (mediaType === 'video') setRemoteUsers(prev => prev.filter(u => u.uid !== remoteUser.uid));
        if (mediaType === 'audio') {
          audioTracksRef.current[remoteUser.uid]?.stop();
          delete audioTracksRef.current[remoteUser.uid];
        }
      });

      await agoraClientRef.current.join(AGORA_APP_ID, `request_${session._id}`, agoraToken, null);
      const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      
      setLocalVideoTrack(videoTrack);
      setLocalAudioTrack(audioTrack);
      localVideoTrackRef.current = videoTrack;
      localAudioTrackRef.current = audioTrack;
      
      await agoraClientRef.current.publish([audioTrack, videoTrack]);
      
      setActiveCall(session);
      setInCall(true);
      setIsMuted(false);
      setIsVideoOff(false);
    } catch (err) {
      console.error('Join call error:', err);
      alert('Could not join call. Please check camera/microphone permissions.');
    }
  };

  useEffect(() => {
    if (state?.session && !inCall) {
      handleJoinSession(state.session);
    }
  }, [state]);

  const handleEndCall = async () => {
    try {
      if (localVideoTrackRef.current) { localVideoTrackRef.current.stop(); localVideoTrackRef.current.close(); }
      if (localAudioTrackRef.current) { localAudioTrackRef.current.stop(); localAudioTrackRef.current.close(); }
      if (agoraClientRef.current) {
        await agoraClientRef.current.leave();
        agoraClientRef.current.removeAllListeners();
      }
      setInCall(false);
      setLocalVideoTrack(null);
      setLocalAudioTrack(null);
      setRemoteUsers([]);
      if (document.fullscreenElement) document.exitFullscreen();
      navigate('/learner/dashboard');
    } catch (err) {
      console.error('Error ending call:', err);
      navigate('/learner/dashboard');
    }
  };

  const handleAcceptCompletion = async () => {
    if (!completionRequest) return;
    try {
      await axios.put(`${SOCKET_URL}/api/payments/confirm-completion/${completionRequest.requestId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      socketRef.current?.emit('accept_session_completion', { requestId: completionRequest.requestId });
      socketRef.current?.emit('payment_status_change', { requestId: completionRequest.requestId, status: 'released' });
      setCompletionRequest(null);
      alert('Session marked as complete. Redirecting to rate your tutor...');
      
      // Navigate to rating page
      const tutorId = activeCall.tutor?._id || activeCall.tutor?.id;
      if (tutorId) {
        navigate(`/learner/rate/${tutorId}`);
      } else {
        navigate('/learner/dashboard');
      }
    } catch (err) {
      console.error('Accept completion error:', err);
    }
  };

  const handleDeclineCompletion = async () => {
    if (!completionRequest) return;
    try {
      await axios.put(`${SOCKET_URL}/api/payments/decline-completion/${completionRequest.requestId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      socketRef.current?.emit('decline_session_completion', { requestId: completionRequest.requestId });
      socketRef.current?.emit('payment_status_change', { requestId: completionRequest.requestId, status: 'declined' });
      setCompletionRequest(null);
      alert('Completion request declined.');
    } catch (err) {
      console.error('Decline completion error:', err);
    }
  };

  const handleToggleMute = () => {
    if (localAudioTrack) {
      localAudioTrack.setEnabled(isMuted);
      setIsMuted(!isMuted);
    }
  };

  const handleToggleCamera = () => {
    if (localVideoTrack) {
      localVideoTrack.setEnabled(isVideoOff);
      setIsVideoOff(!isVideoOff);
    }
  };

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      callContainerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // ─── IN-CALL VIEW ────────────────────────────────────────────────────────────
  if (activeCall) {
    const tutorInitial = activeCall.tutor?.name?.[0]?.toUpperCase() || 'T';
    const learnerInitial = 'L';

    return (
      <div
        ref={callContainerRef}
        className="fixed inset-0 bg-[#080810] z-[999] flex flex-col"
      >
        {/* Top Bar */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-8 py-4 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-white font-black text-sm">{activeCall.skillName} Session</p>
              <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest">with {activeCall.tutor?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-full">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-emerald-400 text-[10px] font-black uppercase tracking-widest">Live</span>
          </div>
        </div>

        {/* Main Video Area */}
        <div className="flex-1 relative bg-[#0d0d18] overflow-hidden p-6 pt-24 pb-32">
          <div className="w-full h-full flex gap-6">
            {/* Remote (Tutor) */}
            <div className="flex-[2] relative">
              {remoteUsers.length > 0 ? (
                <RemoteVideoPlayer videoTrack={remoteUsers[0].videoTrack} label={activeCall.tutor?.name || 'Tutor'} />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#12082b] to-[#0a0a1a] rounded-[40px] flex items-center justify-center relative overflow-hidden border border-white/5 shadow-2xl">
                  {/* Glow effects */}
                  <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none" />
                  <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-violet-600/10 rounded-full blur-[100px] pointer-events-none" />
                  <div className="flex flex-col items-center gap-6">
                    <div className="w-36 h-36 rounded-[3.5rem] bg-indigo-600/20 border-2 border-indigo-500/20 flex items-center justify-center text-white text-6xl font-black shadow-inner">
                      {tutorInitial}
                    </div>
                    <div className="text-center">
                      <p className="text-white font-black text-2xl">{activeCall.tutor?.name || 'Tutor'}</p>
                      <p className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.2em] mt-2">Waiting for tutor to join...</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Self (Learner) */}
            <div className="flex-1 relative">
              {localVideoTrack && !isVideoOff ? (
                <LocalVideoPlayer videoTrack={localVideoTrack} label="You (Learner)" />
              ) : (
                <div className="w-full h-full bg-[#111114] rounded-[40px] border border-white/5 flex items-center justify-center relative shadow-2xl">
                  <div className="w-24 h-24 rounded-[2.5rem] bg-gray-800 flex items-center justify-center text-white text-3xl font-black shadow-inner border border-white/5">
                    {learnerInitial}
                  </div>
                  <div className="absolute bottom-6 left-6 flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                    <div className="w-2 h-2 bg-gray-600 rounded-full" />
                    <span className="text-white font-black text-[10px] uppercase tracking-wider">Camera Off</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Completion Request Prompt */}
        {completionRequest && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md animate-in zoom-in-95 duration-300">
            <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-[3rem] p-10 shadow-2xl text-center space-y-8 relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-16 -mt-16" />
               <div className="w-20 h-20 rounded-[2.5rem] bg-indigo-600 flex items-center justify-center mx-auto shadow-xl shadow-indigo-500/20">
                  <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
               </div>
               <div>
                 <h3 className="text-white text-2xl font-black tracking-tight">Session Complete?</h3>
                 <p className="text-indigo-200/60 text-xs font-black uppercase tracking-widest mt-2">{activeCall.tutor?.name} has requested completion</p>
               </div>
               <p className="text-gray-300 text-sm font-semibold leading-relaxed px-4">
                 By accepting, the held payment will be released to the tutor. You can only rate the tutor after releasing funds.
               </p>
               <div className="flex flex-col gap-3 pt-4">
                 <button 
                  onClick={handleAcceptCompletion}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-emerald-900/40 active:scale-95"
                 >
                   Accept & Release Payment
                 </button>
                 <button 
                  onClick={handleDeclineCompletion}
                  className="w-full py-4 bg-white/5 hover:bg-rose-600/20 text-white/40 hover:text-rose-400 border border-white/10 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all"
                 >
                   Decline Request
                 </button>
               </div>
            </div>
          </div>
        )}

        {/* Bottom Controls — 3 buttons with labels */}
        <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center gap-8 pb-8 pt-20 bg-gradient-to-t from-black/80 to-transparent">

          {/* Mic */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleToggleMute}
              className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-xl ${
                isMuted ? 'bg-red-500/90 shadow-red-500/30' : 'bg-white/10 hover:bg-white/15 border border-white/10'
              }`}
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isMuted
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />}
              </svg>
            </button>
            <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${
              isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-gray-300'
            }`}>{isMuted ? 'Unmute' : 'Mic On'}</span>
          </div>

          {/* Camera */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleToggleCamera}
              className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-xl ${
                isVideoOff ? 'bg-red-500/90 shadow-red-500/30' : 'bg-white/10 hover:bg-white/15 border border-white/10'
              }`}
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isVideoOff
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z M3 3l18 18" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />}
              </svg>
            </button>
            <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${
              isVideoOff ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-gray-300'
            }`}>{isVideoOff ? 'Cam Off' : 'Cam On'}</span>
          </div>

          {/* End Call */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleEndCall}
              className="w-16 h-16 rounded-2xl bg-red-600 hover:bg-red-700 flex items-center justify-center transition-all hover:scale-110 active:scale-90 shadow-xl shadow-red-600/40"
            >
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
              </svg>
            </button>
            <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-400">End Call</span>
          </div>

          {/* Fullscreen */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleToggleFullscreen}
              className="w-16 h-16 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-xl"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isFullscreen
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l-3-3m0 0l3-3m-3 3h3m9 9l3 3m0 0l-3 3m3-3h-3M9 15l-3 3m0 0l3 3m-3-3h3M15 9l3-3m0 0l-3-3m3 3h-3" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />}
              </svg>
            </button>
            <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-white/10 text-gray-300">
              {isFullscreen ? 'Exit Full' : 'Fullscreen'}
            </span>
          </div>

        </div>
      </div>
    );
  }

  // ─── PLACEHOLDER VIEW ─────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-[#0a0a0f] items-center justify-center p-10">
      <div className="text-center space-y-6">
        <div className="w-24 h-24 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-8">
          <svg className="w-12 h-12 text-indigo-500/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-4xl font-black text-white tracking-tight italic">Ready for your Session?</h1>
        <p className="text-gray-500 text-lg max-w-md mx-auto">Please join a session from the <span className="text-indigo-400 font-bold">Chat</span> to start your video call.</p>
        <button 
          onClick={() => navigate('/learner/chat')}
          className="mt-8 bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all hover:scale-105 shadow-xl shadow-indigo-900/30"
        >
          Go to Chat
        </button>
      </div>
    </div>
  );
};

export default VideoSessions;
