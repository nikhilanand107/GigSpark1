import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Component } from 'react';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import TutorDashboard from './pages/tutor/TutorDashboard';
import BrowseRequests from './pages/tutor/BrowseRequests';
import TutorDemoUpload from './pages/tutor/TutorDemoUpload';
import TutorChatSessions from './pages/tutor/ChatSessions';
import TutorVideoSessions from './pages/tutor/VideoSessions';
import TutorProfile from './pages/tutor/TutorProfile';
import LearnerDashboard from './pages/learner/LearnerDashboard';
import FindTutor from './pages/learner/FindTutor';
import RequestSkill from './pages/learner/RequestSkill';
import LearnerChatSessions from './pages/learner/ChatSessions';
import LearnerVideoSessions from './pages/learner/VideoSessions';
import PaymentSessions from './pages/learner/PaymentSessions';
import LearnerProfile from './pages/learner/LearnerProfile';
import RatingPage from './pages/learner/RatingPage';
import './index.css';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('App ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', gap: 16 }}>
          <h2 style={{ color: '#ef4444', fontWeight: 900 }}>Something went wrong</h2>
          <p style={{ color: '#6b7280', fontSize: 14 }}>{this.state.error?.message || 'Unexpected error occurred'}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}
            style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 24px', fontWeight: 900, cursor: 'pointer', fontSize: 13 }}
          >
            Go to Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ProtectedRoute = ({ children, role }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const userRole = user.role?.toLowerCase();
  const requiredRole = role?.toLowerCase();
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/login" element={
        user ? (
          user.role?.toLowerCase() === 'tutor'
            ? <Navigate to="/tutor/dashboard" replace />
            : <Navigate to="/learner/dashboard" replace />
        ) : <Login />
      } />
      <Route path="/register" element={<Register />} />
      {/* Tutor Routes */}
      <Route path="/tutor/dashboard" element={<ProtectedRoute role="tutor"><TutorDashboard /></ProtectedRoute>} />
      <Route path="/tutor/browse-requests" element={<ProtectedRoute role="tutor"><BrowseRequests /></ProtectedRoute>} />
      <Route path="/tutor/demo-upload/:requestId/:skillName" element={<ProtectedRoute role="tutor"><TutorDemoUpload /></ProtectedRoute>} />
      <Route path="/tutor/chat" element={<ProtectedRoute role="tutor"><TutorChatSessions /></ProtectedRoute>} />
      <Route path="/tutor/video" element={<ProtectedRoute role="tutor"><TutorVideoSessions /></ProtectedRoute>} />
      <Route path="/tutor/profile" element={<ProtectedRoute role="tutor"><TutorProfile /></ProtectedRoute>} />
      {/* Learner Routes */}
      <Route path="/learner/dashboard" element={<ProtectedRoute role="learner"><LearnerDashboard /></ProtectedRoute>} />
      <Route path="/learner/find-tutor" element={<ProtectedRoute role="learner"><FindTutor /></ProtectedRoute>} />
      <Route path="/learner/request-skill" element={<ProtectedRoute role="learner"><RequestSkill /></ProtectedRoute>} />
      <Route path="/learner/chat" element={<ProtectedRoute role="learner"><LearnerChatSessions /></ProtectedRoute>} />
      <Route path="/learner/video" element={<ProtectedRoute role="learner"><LearnerVideoSessions /></ProtectedRoute>} />
      <Route path="/learner/payments" element={<ProtectedRoute role="learner"><PaymentSessions /></ProtectedRoute>} />
      <Route path="/learner/profile" element={<ProtectedRoute role="learner"><LearnerProfile /></ProtectedRoute>} />
      <Route path="/learner/rate/:tutorId" element={<ProtectedRoute role="learner"><RatingPage /></ProtectedRoute>} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <ErrorBoundary>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
