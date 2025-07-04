import React, { useState, useEffect, useRef, memo, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import './MiddlePanel.css';
import apiCache from '../../utils/apiCache';
import eventService, { FILE_EVENTS } from '../../utils/eventService';
import fileDataService from '../../utils/fileDataService';
import HomeSection from './HomeSection';
import SummaryTableView from './Summary/SummaryTableView';

const API_BASE_URL = process.env.REACT_APP_API_URL;

const MiddlePanel = ({ type, message, currentPath }) => {
  const location = useLocation();
  const [currentSection, setCurrentSection] = useState(currentPath || 'upload');
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [dragActive, setDragActive] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [uploadStatus, setUploadStatus] = useState({
    type: 'default',
    message: ''
  });
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [showUploadedFiles, setShowUploadedFiles] = useState(false);
  const hasInitializedRef = useRef(false);
  const [folderName, setFolderName] = useState('');
  const [folders, setFolders] = useState({});
  const [processingFolders, setProcessingFolders] = useState(() => {
    // Load from localStorage for persistence across section changes
    try {
      const stored = localStorage.getItem('processingFolders');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Fetch user info and session ID from backend
  useEffect(() => {
    const fetchSessionInfo = async () => {
      // Check if we already have session info in localStorage
      const cachedSession = localStorage.getItem('sessionInfo');
      
      if (cachedSession) {
        try {
          const sessionData = JSON.parse(cachedSession);
          const now = Date.now();
          
          // Use cached data if it's less than 30 minutes old
          if (sessionData.timestamp && (now - sessionData.timestamp < 30 * 60 * 1000)) {
            console.log('Using cached session info');
            setSessionId(sessionData.sessionId);
            setUsername(sessionData.username);
            setUserEmail(sessionData.userEmail);
            setIsLoading(false);
            return;
          }
        } catch (e) {
          console.error('Error parsing cached session:', e);
          // Continue to fetch fresh data if parsing fails
        }
      }
      
      try {
        setIsLoading(true);
        // Get session info from the backend
        const response = await axios.get(`${API_BASE_URL}/api/session`, {
          withCredentials: true
        });
        
        if (response.data.success) {
          const sessionData = {
            sessionId: response.data.sessionId,
            username: response.data.username,
            userEmail: response.data.userEmail,
            timestamp: Date.now()
          };
          
          // Save to localStorage
          localStorage.setItem('sessionInfo', JSON.stringify(sessionData));
          
          setSessionId(response.data.sessionId);
          setUsername(response.data.username);
          setUserEmail(response.data.userEmail);
        } else {
          // Fallback to locally generated values
          generateLocalSessionId();
        }
      } catch (error) {
        console.error('Error fetching session information:', error);
        // Fallback to locally generated values
        generateLocalSessionId();
      } finally {
        setIsLoading(false);
      }
    };

    // Fallback function to generate session ID locally
    const generateLocalSessionId = () => {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
      const newSessionId = `session-${dateStr}-${timeStr}`;
      setSessionId(newSessionId);
      
      // Fallback to localStorage for email
      const savedEmail = localStorage.getItem('userEmail') || 'anonymous@user.com';
      setUserEmail(savedEmail);
      const generatedUsername = savedEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
      setUsername(generatedUsername);
      
      // Cache even the generated session info
      const sessionData = {
        sessionId: newSessionId,
        username: generatedUsername,
        userEmail: savedEmail,
        timestamp: Date.now()
      };
      localStorage.setItem('sessionInfo', JSON.stringify(sessionData));
    };

    // Only fetch session info once when component first mounts, not on every navigation
    if (!hasInitializedRef.current) {
      fetchSessionInfo();
      hasInitializedRef.current = true;
    }
  }, []);

  // Fetch session files from backend
  const fetchSessionFiles = async () => {
    if (!sessionId) return;
    
    try {
      const response = await axios.get(`${API_BASE_URL}/api/session/files`, {
        withCredentials: true
      });
      
      if (response.data.success && Array.isArray(response.data.files)) {
        setUploadedFiles(response.data.files);
        if (response.data.files.length > 0) {
          setShowUploadedFiles(true);
        }
      }
    } catch (error) {
      console.error('Error fetching session files:', error);
    }
  };

  // Load session files when sessionId changes
  useEffect(() => {
    if (sessionId && currentSection === 'upload') {
      fetchSessionFiles();
    }
  }, [sessionId, currentSection]);

  // Handle file dragging events
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  // Handle file drop events
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // Handle file selection from input
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const filteredFiles = Array.from(e.target.files).filter(file => {
        const extension = file.name.split('.').pop().toLowerCase();
        return ['pdf', 'doc', 'docx'].includes(extension);
      });
      
      if (filteredFiles.length !== e.target.files.length) {
        setUploadStatus({
          type: 'warning',
          message: 'Some files were not added. Only PDF and Word documents are supported.'
        });
      }
      
      if (filteredFiles.length > 0) {
        handleFiles(filteredFiles);
      }
    }
  };

  // Process selected files
  const handleFiles = (selectedFiles) => {
    // Only accept PDF and Word documents
    const validFiles = selectedFiles.filter(file => {
      const extension = file.name.split('.').pop().toLowerCase();
      return ['pdf', 'doc', 'docx'].includes(extension);
    });
    
    const newFiles = validFiles.filter(
      file => !files.some(existingFile => existingFile.name === file.name)
    );
    
    setFiles(prevFiles => [...prevFiles, ...newFiles]);
  };

  // Remove a file from the selection
  const removeFile = (fileName) => {
    setFiles(prevFiles => prevFiles.filter(file => file.name !== fileName));
  };

  // Email input handler
  const handleEmailChange = (e) => {
    const email = e.target.value;
    setUserEmail(email);
    localStorage.setItem('userEmail', email);
  };

  // Upload the selected files
  const uploadFiles = async () => {
    if (files.length === 0) {
      setUploadStatus({
        type: 'warning',
        message: 'Please add files to upload'
      });
      return;
    }

    if (!folderName || !folderName.trim()) {
      setUploadStatus({
        type: 'warning',
        message: 'Please enter a folder name for your uploads'
      });
      return;
    }

    setIsUploading(true);
    setUploadStatus({
      type: 'info',
      message: 'Uploading files...'
    });
    
    // Clear previous uploaded files display
    setShowUploadedFiles(false);
    
    // Create folder path: username/sessionId/folderName/
    const folderPath = `${username}/${sessionId}/${folderName.trim()}/`;
    
    const uploadPromises = files.map(async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folderPath', folderPath);
      
      try {
        const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          withCredentials: true, // Include cookies for session authentication
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(prev => ({
              ...prev,
              [file.name]: percentCompleted
            }));
          }
        });
        
        return { 
          file, 
          success: true, 
          response: response.data
        };
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        return { file, success: false, error };
      }
    });

    try {
      const results = await Promise.all(uploadPromises);
      const successCount = results.filter(result => result.success).length;
      
      if (successCount === files.length) {
        setUploadStatus({
          type: 'success',
          message: `Successfully uploaded ${successCount} files to folder "${folderName}" in session ${sessionId}`
        });
      } else {
        setUploadStatus({
          type: 'warning',
          message: `Uploaded ${successCount} out of ${files.length} files to folder "${folderName}" in session ${sessionId}`
        });
      }
      
      // Invalidate any file-related caches to ensure fresh data
      if (typeof apiCache !== 'undefined') {
        console.log('Invalidating file caches after upload');
        apiCache.invalidate(`${API_BASE_URL}/api/files`);
        apiCache.invalidate(`${API_BASE_URL}/api/session/files`);
        apiCache.invalidate(`${API_BASE_URL}/api/dashboard/stats`);
      }
      
      // Notify file components that files have been uploaded
      if (successCount > 0) {
        console.log('Publishing file upload event');
        eventService.publish(FILE_EVENTS.FILES_UPLOADED, {
          files: results.filter(r => r.success).map(r => r.file.name),
          count: successCount,
          sessionId
        });
      }
      
      // Fetch the latest session files from the backend
      await fetchSessionFiles();
      
      // Clear uploaded files that were successful
      const failedFiles = results
        .filter(result => !result.success)
        .map(result => result.file);
      
      setFiles(failedFiles);
    } catch (error) {
      console.error('Error during upload:', error);
      setUploadStatus({
        type: 'error',
        message: 'Error uploading files'
      });
    } finally {
      setIsUploading(false);
      setUploadProgress({});
    }
  };

  // Format bytes to a readable size
  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Format date for display
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Get file type icon
  const getFileTypeIcon = (fileName) => {
    const ext = fileName.split('.').pop().toLowerCase();
    
    switch(ext) {
      case 'pdf':
        return '📕';
      case 'doc':
      case 'docx':
        return '📘';
      case 'txt':
        return '📄';
      default:
        return '📃';
    }
  };

  const getStatusIcon = (statusType) => {
    switch(statusType) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '📝';
    }
  };
  useEffect(() => {
    // Only update section when currentPath prop changes
    if (currentPath && currentPath !== currentSection) {
      setCurrentSection(currentPath);
      console.log(`MiddlePanel: Updating section to ${currentPath} from prop`);
    }
  }, [currentPath, currentSection]);
  // Remove the redundant location-based useEffect to prevent conflicts
  // The currentPath prop should be the single source of truth
  
  // Memoize section content to prevent unnecessary re-renders
  const sectionContent = useMemo(() => {
    const currentSectionToRender = currentPath || 'upload';
    console.log(`Rendering section: ${currentSectionToRender}`);
    
    // Use currentSectionToRender consistently to avoid confusion
    switch (currentSectionToRender) {
      case 'home':
        return <HomeSection />;
      case 'upload':
        return (
          <div className="file-upload-section">
            <div className="section-header">
              <h2>Upload Documents</h2>
              <p>Upload your documents for processing and analysis</p>
            </div>

            {/* User Info & Session */}
            <div className="user-session-info">
              <div className="form-group">
                <label htmlFor="folder-name" className="folder-label">Name your upload folder:</label>
                <input
                  id="folder-name"
                  type="text"
                  placeholder="Enter a name for your upload folder"
                  value={folderName || ''}
                  onChange={(e) => setFolderName(e.target.value)}
                  className="folder-name-input"
                />
              </div>
              <div className="session-info">
                <span className="session-label">Upload Session:</span>
                <span className="session-id">{sessionId}</span>
              </div>
            </div>

            {/* Drag & Drop Area */}
            <div 
              className={`drag-drop-area ${dragActive ? 'active' : ''}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
            >
              <div className="drag-drop-content">
                <div className="upload-icon">📁</div>
                <p>Drag and drop files here or</p>
                <label className="file-input-label">
                  Browse Files
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileChange}
                    className="file-input"
                  />
                </label>
                <p className="supported-files">Supported formats: PDF, DOC, DOCX</p>
              </div>
            </div>

            {/* Selected Files List */}
            {files.length > 0 && (
              <div className="selected-files-container">
                <div className="selected-files-header">
                  <h3>Selected Files</h3>
                  <span className="file-count">{files.length} file(s)</span>
                </div>
                
                <ul className="selected-files-list">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="file-item">
                      <div className="file-info">
                        <div className="file-type-icon">
                          {getFileTypeIcon(file.name)}
                        </div>
                        <div className="file-details">
                          <span className="file-name">{file.name}</span>
                          <span className="file-size">{formatBytes(file.size)}</span>
                        </div>
                      </div>
                      
                      {isUploading && uploadProgress[file.name] !== undefined ? (
                        <div className="progress-container">
                          <div className="progress-bar">
                            <div 
                              className="progress-fill" 
                              style={{ width: `${uploadProgress[file.name]}%` }}
                            ></div>
                          </div>
                          <span className="progress-text">{uploadProgress[file.name]}%</span>
                        </div>
                      ) : (
                        <button 
                          className="remove-file-btn" 
                          onClick={() => removeFile(file.name)}
                          disabled={isUploading}
                          aria-label="Remove file"
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {/* Upload Button */}
                <div className="upload-actions">
                  <button 
                    className="upload-button compact" 
                    onClick={uploadFiles}
                    disabled={isUploading || files.length === 0}
                  >
                    {isUploading ? 'Uploading...' : 'Upload Files'}
                  </button>
                  
                  {!isUploading && files.length > 0 && (
                    <button 
                      className="clear-button compact"
                      onClick={() => setFiles([])}
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Upload Status */}
            {uploadStatus.message && (
              <div className={`upload-status ${uploadStatus.type}`}>
                <div className="status-icon">{getStatusIcon(uploadStatus.type)}</div>
                <div className="status-message">{uploadStatus.message}</div>
              </div>
            )}

            {/* Recently Uploaded Files */}
            {showUploadedFiles && uploadedFiles.length > 0 && (
              <div className="uploaded-files-container">
                <div className="uploaded-files-header">
                  <h3>Successfully Uploaded Files</h3>
                  <div className="header-controls">
                    <span className="uploaded-count">{uploadedFiles.length} file(s)</span>
                    <button 
                      className="collapse-button"
                      onClick={() => setShowUploadedFiles(false)}
                    >
                      Hide
                    </button>
                  </div>
                </div>
                
                <ul className="uploaded-files-list">
                  {uploadedFiles.map((file, index) => (
                    <li key={index} className="uploaded-file-item">
                      <div className="uploaded-file-info">
                        <div className="file-type-icon">
                          {getFileTypeIcon(file.fileName)}
                        </div>
                        <div className="uploaded-file-details">
                          <div className="uploaded-file-name-row">
                            <span className="uploaded-file-name">{file.fileName}</span>
                            <span className="uploaded-file-size">{formatBytes(file.fileSize)}</span>
                          </div>
                          <div className="uploaded-file-meta">
                            <span className="upload-time">
                              Uploaded: {formatDate(file.uploadedAt)}
                            </span>
                            <span className="file-type">
                              Type: {file.contentType || 'Unknown'}
                            </span>
                          </div>
                          <div className="uploaded-file-path">
                            <span className="s3-path">Path: {file.s3Key}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="uploaded-file-actions">
                        {file.s3Url && (
                          <a 
                            href={file.s3Url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="view-file-btn"
                          >
                            View
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      case 'files':
        return <FilesSection />;
      case 'chat':
        return <ChatSection />;
      default:
        // Default to upload section if route is unknown
        return (
          <div className="file-upload-section">
            <div className="section-header">
              <h2>Upload Documents</h2>
              <p>Upload your documents for processing and analysis</p>
            </div>
            
            {/* User Info & Session */}
            <div className="user-session-info">
              <div className="form-group">
                <label htmlFor="folder-name" className="folder-label">Name your upload folder:</label>
                <input
                  id="folder-name"
                  type="text"
                  placeholder="Enter a name for your upload folder"
                  value={folderName || ''}
                  onChange={(e) => setFolderName(e.target.value)}
                  className="folder-name-input"
                />
              </div>
              <div className="session-info">
                <span className="session-label">Upload Session:</span>
                <span className="session-id">{sessionId}</span>
              </div>
            </div>

            {/* Drag & Drop Area */}
            <div 
              className={`drag-drop-area ${dragActive ? 'active' : ''}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
            >
              <div className="drag-drop-content">
                <div className="upload-icon">📁</div>
                <p>Drag and drop files here or</p>
                <label className="file-input-label">
                  Browse Files
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileChange}
                    className="file-input"
                  />
                </label>
                <p className="supported-files">Supported formats: PDF, DOC, DOCX</p>
              </div>
            </div>
          </div>
        );
    }
  }, [
    currentPath,
    folderName,
    sessionId,
    dragActive,
    files,
    isUploading,
    uploadProgress,
    uploadStatus,
    showUploadedFiles,
    uploadedFiles
  ]);
  return (
    <div className="middle-panel-container">
      {/* Dynamic Content Section */}
      {sectionContent}
    </div>
  );
};

const ChatSection = () => {
  const [summaries, setSummaries] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingFolders, setIsFetchingFolders] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [sessionId, setSessionId] = useState('');
  const [folders, setFolders] = useState([]);
  const [lastFetchTime, setLastFetchTime] = useState(0);
  const FETCH_COOLDOWN = 30000; // 30 seconds cooldown

  useEffect(() => {
    const cachedSession = localStorage.getItem('sessionInfo');
    if (cachedSession) {
      try {
        const sessionData = JSON.parse(cachedSession);
        setSessionId(sessionData.sessionId);
      } catch (e) {
        console.error('Error parsing cached session:', e);
      }
    }
  }, []);

  useEffect(() => {
    const fetchFolders = async () => {
      if (!sessionId) {
        setIsFetchingFolders(false);
        setIsLoading(false);
        return;
      }
      setIsFetchingFolders(true);
      setError(null);
      try {
        const response = await axios.get(`${API_BASE_URL}/api/summaries/${sessionId}/folders`, { withCredentials: true });
        if (response.data && response.data.success) {
          setFolders(response.data.folders);
        } else {
          throw new Error(response.data.message || 'Failed to fetch folders');
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load processed folders');
        setFolders([]);
      } finally {
        setIsFetchingFolders(false);
        if (!selectedFolder) setIsLoading(false);
      }
    };
    if (sessionId) fetchFolders();
  }, [sessionId]);

  useEffect(() => {
    const fetchSummaries = async () => {
      if (!sessionId || !selectedFolder) {
        setSummaries(null); 
        if (selectedFolder) setIsLoading(false);
        return;
      }
      const now = Date.now();
      if (summaries && now - lastFetchTime < FETCH_COOLDOWN && !error) {
        setIsLoading(false); 
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const response = await axios.get(`${API_BASE_URL}/api/summaries/${sessionId}/folder/${selectedFolder}`, { withCredentials: true });
        if (response.data && response.data.success) {
          setSummaries(response.data.summaries);
          setLastFetchTime(now);
        } else {
          throw new Error(response.data.message || 'Failed to fetch summaries');
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load document summaries');
        setSummaries(null);
      } finally {
        setIsLoading(false);
      }
    };

    if (selectedFolder) {
         fetchSummaries();
    } else {
        setSummaries(null);
        setIsLoading(false); 
    }
  }, [sessionId, selectedFolder, lastFetchTime]);

  const handleRefreshFolders = async () => {
      if (!sessionId) return;
      setIsFetchingFolders(true);
      setError(null);
      try {
        const response = await axios.get(`${API_BASE_URL}/api/summaries/${sessionId}/folders`, { withCredentials: true });
        if (response.data && response.data.success) {
          setFolders(response.data.folders);
        } else {
          throw new Error(response.data.message || 'Failed to refresh folders');
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to refresh folders');
        setFolders([]);
      } finally {
        setIsFetchingFolders(false);
        if (!selectedFolder) setIsLoading(false);
      }
  };

  const handleRefreshSummaries = async () => {
    if (!sessionId || !selectedFolder) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/summaries/${sessionId}/refresh`, { folderName: selectedFolder }, { withCredentials: true });
      if (response.data && response.data.success) {
        setSummaries(response.data.summaries);
        setLastFetchTime(Date.now()); 
      } else {
        throw new Error(response.data.message || 'Failed to refresh summaries');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to refresh summaries');
      setSummaries(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFolderSelect = (folderName) => {
    setSelectedFolder(folderName);
    setSummaries(null); 
    setError(null); 
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return 'Invalid date';
    }
  };

  // 1. Initial loading state (fetching folders)
  if (isFetchingFolders) {
    return (
      <div className="chat-section">
        <div className="section-header">
          <h2>Document Summaries</h2>
          <p>Select a processed folder to view summaries</p>
        </div>
        <div className="folders-loading"><p>Loading processed folders...</p></div>
      </div>
    );
  }

  // 2. No folder selected - show folder list or error if folder fetch failed
  if (!selectedFolder) {
    return (
      <div className="chat-section">
        <div className="section-header">
          <h2>Document Summaries</h2>
          <p>Select a processed folder to view summaries</p>
          <button className="refresh-button" onClick={handleRefreshFolders} disabled={isFetchingFolders}>
            {isFetchingFolders ? 'Refreshing...' : 'Refresh Folders'}
          </button>
        </div>
        {error && <div className="folders-error"><p>Error loading folders: {error}</p></div>} 
        {!error && folders.length === 0 && 
          <div className="folders-empty"><p>No processed folders found. Upload and process files to see summaries.</p></div>
        }
        {!error && folders.length > 0 && (
          <div className="folders-grid">
            {folders.map((folder, index) => (
              <div key={folder.name} className="folder-card" onClick={() => handleFolderSelect(folder.name)} style={{animationDelay: `${index * 0.1}s`}}>
                <div className="floating-dot"></div>
                <div className="floating-dot"></div>
                <div className="floating-dot"></div>
                <div className="folder-info">
                  <h3 className="folder-name">{folder.name}</h3>
                  <div className="folder-metadata">
                    {folder.lastUpdated && <p className="folder-date">Updated: {formatDate(folder.lastUpdated)}</p>}
                    <p className="folder-count">Processed Summary</p>
                  </div>
                </div>
                <button className="process-folder-btn" onClick={(e) => { e.stopPropagation(); handleFolderSelect(folder.name); }}>View Summary</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 3. Folder is selected - handle summaries display (loading, error, data, or no data)
  const renderHeaderForSelectedFolder = () => (
    <div className="chat-header">
      <div className="header-left"><h2>{`Summary Data: ${selectedFolder}`}</h2></div>
      <div className="header-right">
        <button className="back-button" onClick={() => { setSelectedFolder(null); setError(null); setSummaries(null); }}>Back to Folders</button>
        <button className="refresh-button" onClick={handleRefreshSummaries} disabled={isLoading}>{isLoading ? 'Refreshing...' : 'Refresh Summaries'}</button>
      </div>
    </div>
  );

  if (isLoading) { // Loading summaries for the selected folder
    return (
      <div className="chat-section">
        {renderHeaderForSelectedFolder()}
        <div className="folders-loading"><p>Loading summaries for {selectedFolder}...</p></div>
      </div>
    );
  }

  if (error) { // Error loading summaries for the selected folder
    return (
      <div className="chat-section">
        {renderHeaderForSelectedFolder()}
        <div className="folders-error"><p>Error loading summaries: {error}</p></div>
      </div>
    );
  }

  if (summaries && summaries.length > 0) {
    return (
      <div className="chat-section">
        {renderHeaderForSelectedFolder()}
        <SummaryTableView summaries={summaries} />
      </div>
    );
  }

  // If summaries are null or empty after loading and no error for the selected folder
  return (
    <div className="chat-section">
      {renderHeaderForSelectedFolder()}
      <div className="folders-empty">
        <p>No summaries available for this folder. It might still be processing, or no summaries were generated. Try refreshing or check back later.</p>
      </div>
    </div>
  );
};

// FilesSection component
const FilesSection = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fileData, setFileData] = useState([]);
  const [folders, setFolders] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [processingFolder, setProcessingFolder] = useState(null);
  const [processingSuccess, setProcessingSuccess] = useState(null);
  const [processedFolders, setProcessedFolders] = useState([]);
  const [loadingProcessedStatus, setLoadingProcessedStatus] = useState(false);
  const location = useLocation();
  const currentPath = location.pathname.split('/')[1] || 'upload';
  const [processingFolders, setProcessingFolders] = useState(() => {
    // Load from localStorage for persistence across section changes
    try {
      const stored = localStorage.getItem('processingFolders');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Function to fetch processed folders from summaries API
  const fetchProcessedFolders = async () => {
    // Get session info from localStorage
    const cachedSession = localStorage.getItem('sessionInfo');
    if (!cachedSession) {
      console.log('No session info available for fetching processed folders');
      return;
    }

    try {
      setLoadingProcessedStatus(true);
      const sessionData = JSON.parse(cachedSession);
      const sessionId = sessionData.sessionId;

      console.log(`Fetching processed folders for session: ${sessionId}`);
      const response = await axios.get(`${API_BASE_URL}/api/summaries/${sessionId}/folders`, {
        withCredentials: true
      });

      if (response.data && response.data.success) {
        console.log('Processed folders:', response.data.folders);
        setProcessedFolders(response.data.folders);
      }
    } catch (err) {
      console.error('Error fetching processed folders:', err);
      // Don't set an error state, just log it - this is a non-critical operation
    } finally {
      setLoadingProcessedStatus(false);
    }
  };

  // Check if a folder is processed
  const isFolderProcessed = (folderName) => {
    return processedFolders.some(folder => folder.name === folderName);
  };

  // Get the process status of a folder
  const getFolderProcessStatus = (folderName) => {
    const processedFolder = processedFolders.find(folder => folder.name === folderName);
    if (processedFolder) {
      return {
        processed: true,
        lastUpdated: processedFolder.lastUpdated
      };
    }
    return { processed: false };
  };

  // Load processed folders when component mounts
  useEffect(() => {
    if (currentPath === 'files') {
      fetchProcessedFolders();
    }
  }, [currentPath]);

  // Refresh processed folders status after processing
  useEffect(() => {
    if (processingSuccess) {
      // Wait a moment to allow processing to be registered
      const timer = setTimeout(() => {
        fetchProcessedFolders();
      }, 5000); // 5 seconds delay
      
      return () => clearTimeout(timer);
    }
  }, [processingSuccess]);

  // Function to handle refresh button click
  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      // Always fetch fresh data from backend, bypassing any cache
      const cachedSession = localStorage.getItem('sessionInfo');
      if (!cachedSession) {
        setError('No session info found. Please reload the page.');
        setIsRefreshing(false);
        return;
      }
      const { sessionId } = JSON.parse(cachedSession);
      // Add cache-busting param to ensure backend does not serve from cache
      const response = await axios.get(`${API_BASE_URL}/api/session/files?refresh=1&ts=${Date.now()}`, {
        withCredentials: true
      });
      if (response.data.success && Array.isArray(response.data.files)) {
        setFileData(response.data.files);
        setError(null);
      } else {
        setError('Failed to fetch files.');
      }
    } catch (err) {
      setError('Error refreshing files.');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Process data to organize by user-named folders
  const processFileData = (data) => {
    console.log("Processing file data for folder view:", data);
    
    let fileList = [];
    
    if (Array.isArray(data)) {
      fileList = data;
    } else if (data && Array.isArray(data.Items)) {
      fileList = data.Items;
    } else if (data && data.success === true && Array.isArray(data.items)) {
      fileList = data.items;
    } else {
      console.warn("Data format not recognized:", data);
      for (const key in data) {
        if (Array.isArray(data[key])) {
          fileList = data[key];
          break;
        }
      }
    }
    
    setFileData(fileList);
    
    if (fileList.length > 0) {
      // Debug: Inspect the first file to understand its structure
      console.log("Sample file object structure:", fileList[0]);
      
      // Group files by user folder
      const folderGroups = {};
      
      fileList.forEach(file => {
        // Get userFolder or extract from path
        const userFolder = file.userFolder || extractUserFolderFromPath(file.s3Key || '');
        if (!userFolder) return;
        
        if (!folderGroups[userFolder]) {
          folderGroups[userFolder] = {
            name: userFolder,
            files: [],
            creationDate: null,
            sessionId: file.sessionId || ''
          };
        }
        
        // Ensure the file has a key property for deletion
        const fileWithKey = {
          ...file,
          key: file.key || file.s3Key || file.Key
        };
        
        folderGroups[userFolder].files.push(fileWithKey);
        
        // Update folder creation date with the earliest file date
        const fileDate = new Date(file.uploadTimestamp || file.timestamp || 0);
        if (!folderGroups[userFolder].creationDate || fileDate < folderGroups[userFolder].creationDate) {
          folderGroups[userFolder].creationDate = fileDate;
        }
      });
      
      console.log("Setting folder groups:", folderGroups);
      setFolders(folderGroups);
      setError(null);
    } else {
      setFolders({});
      if (fileList.length === 0) {
        console.log("No files found");
      } else {
        console.warn("Unexpected data format:", data);
        setError("Unexpected data format. Please refresh.");
      }
    }
  };
  
  // Extract user folder from S3 key path
  const extractUserFolderFromPath = (path) => {
    if (!path) return null;
    
    const parts = path.split('/');
    if (parts.length >= 3) {
      return parts[2]; // username/sessionId/userFolder/filename
    }
    return null;
  };
  
  // Format date for display
  const formatDate = (date) => {
    if (!date) return 'Unknown date';
    
    try {
      return new Date(date).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return 'Invalid date';
    }
  };
  
  // Open/close folder modal
  const toggleFolder = (folderName) => {
    if (selectedFolder === folderName) {
      setSelectedFolder(null);
    } else {
      setSelectedFolder(folderName);
    }
  };
  
  // Function to handle file deletion
  const handleDeleteFile = async (file) => {
    console.log('Delete called with file object:', file);
    
    if (!file) {
      console.error('Cannot delete file: no file object provided');
      return;
    }
    
    if (!file.key) {
      console.error('Cannot delete file: file object has no key property', file);
      return;
    }
    
    console.log('Delete button clicked for file with key:', file.key);
    
    if (!window.confirm(`Are you sure you want to delete "${file.fileName}"?`)) {
      return;
    }
    
    // Set a local loading state for the file being deleted
    const fileKey = file.key;
    setFolders(prevFolders => {
      const newFolders = { ...prevFolders };
      if (newFolders[selectedFolder]) {
        // Find the file and mark it as deleting
        const updatedFiles = newFolders[selectedFolder].files.map(f => 
          f.key === fileKey ? { ...f, isDeleting: true } : f
        );
        newFolders[selectedFolder] = {
          ...newFolders[selectedFolder],
          files: updatedFiles
        };
      }
      return newFolders;
    });
    
    try {
      console.log(`Sending delete request for file key: ${file.key}`);
      
      // Based on the backend code, the correct endpoint is /delete-file
      // The router is mounted at the root level in app.js with app.use('/', fileRoutes)
      const response = await fetch(`${API_BASE_URL}/delete-file`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key: file.key }),
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`Server returned error ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Delete file response:', data);
      
      if (data.success) {
        console.log('File deleted successfully, updating UI');
        
        // Remove the file from the folders state
        if (folders[selectedFolder]) {
          const updatedFiles = folders[selectedFolder].files.filter(f => f.key !== file.key);
          
          // Update the folders state
          setFolders(prevFolders => {
            const newFolders = { ...prevFolders };
            
            if (updatedFiles.length > 0) {
              // Update folder with remaining files
              newFolders[selectedFolder] = {
                ...newFolders[selectedFolder],
                files: updatedFiles
              };
            } else {
              // If no files left, remove the folder
              delete newFolders[selectedFolder];
              setSelectedFolder(null); // Close the modal
            }
            
            return newFolders;
          });
          
          // Invalidate caches
          if (typeof apiCache !== 'undefined' && apiCache.invalidate) {
            apiCache.invalidate(`${API_BASE_URL}/api/files`);
            apiCache.invalidate(`${API_BASE_URL}/api/session/files`);
            apiCache.invalidate(`${API_BASE_URL}/api/dashboard/stats`);
            console.log('API caches invalidated after file deletion');
          }
          
          // Notify that files have been deleted
          eventService.publish(FILE_EVENTS.FILES_DELETED, {
            fileName: file.fileName,
            key: file.key
          });
          console.log('Published file deleted event');
        }
      } else {
        // If delete failed, remove the deleting state
        setFolders(prevFolders => {
          const newFolders = { ...prevFolders };
          if (newFolders[selectedFolder]) {
            const updatedFiles = newFolders[selectedFolder].files.map(f => 
              f.key === fileKey ? { ...f, isDeleting: false } : f
            );
            newFolders[selectedFolder] = {
              ...newFolders[selectedFolder],
              files: updatedFiles
            };
          }
          return newFolders;
        });
        
        console.error('Server returned success=false:', data);
        alert(`Error: ${data.error || 'Failed to delete file'}`);
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      
      // If delete failed due to exception, remove the deleting state
      setFolders(prevFolders => {
        const newFolders = { ...prevFolders };
        if (newFolders[selectedFolder]) {
          const updatedFiles = newFolders[selectedFolder].files.map(f => 
            f.key === fileKey ? { ...f, isDeleting: false } : f
          );
          newFolders[selectedFolder] = {
            ...newFolders[selectedFolder],
            files: updatedFiles
          };
        }
        return newFolders;
      });
      
      alert(`Error deleting file: ${error.message || 'Unknown error'}`);
    }
  };
  
  // Fetch files when component mounts
  useEffect(() => {
    if (currentPath !== 'files') {
      return;
    }
    
    console.log('FilesSection mounted - fetching data');
    setIsLoading(true);
    
    fileDataService.fetchFileData()
      .then(data => {
        processFileData(data);
      })
      .catch(err => {
        console.error('Error fetching files:', err);
        setError('Failed to fetch files: ' + (err.message || 'Unknown error'));
      })
      .finally(() => {
        setIsLoading(false);
      });
    
    // Subscribe to file data updates
    const dataUpdateSubscription = eventService.subscribe(FILE_EVENTS.FILES_DATA_UPDATED, (event) => {
      console.log('File data updated event received, processing new folder data');
      if (event && event.data) {
        processFileData(event.data);
      }
    });
    
    return () => {
      dataUpdateSubscription(); // Unsubscribe on unmount
      console.log('FilesSection unmounted - cleaning up');
    };
  }, [currentPath]);
  
  // Don't render anything if not on files section
  if (currentPath !== 'files') {
    return null;
  }
  
  // Function to handle processing a folder
  const handleProcessFolder = async (folderName, sessionId) => {
    try {
      if (!folderName) {
        console.error('No folder name provided for processing');
        return;
      }
      
      if (!sessionId) {
        console.error('No session ID provided for processing');
        setError('Missing session ID for processing');
        return;
      }

      // Add to processingFolders for persistent animation
      if (!processingFolders.includes(folderName)) {
        updateProcessingFolders([...processingFolders, folderName]);
      }
      setProcessingSuccess(null);
      setError(null);
      
      console.log(`Processing folder: ${folderName}, session: ${sessionId}`);
      
      // Call the backend endpoint to process the folder
      const response = await axios.post(
        `${API_BASE_URL}/processfolder`,
        {
          folderName,
          sessionId
        },
        {
          withCredentials: true
        }
      );
      
      console.log('Process folder response:', response.data);
      
      if (response.data && response.data.success) {
        // Show success message
        setProcessingSuccess({
          folderName,
          message: 'Folder processing initiated successfully. Check summaries section in a few minutes.'
        });
        
        // Refresh file list after processing
        handleRefresh();
      } else {
        throw new Error(response.data?.error || 'Failed to initiate folder processing');
      }
    } catch (err) {
      console.error('Error processing folder:', err);
      setError(`Failed to process folder: ${err.response?.data?.error || err.message}`);
      setProcessingSuccess(null);
    } finally {
      // Clear processing state after delay
      setTimeout(() => {
        setProcessingFolder(null);
      }, 3000);
    }
  };
  
  // Utility to sync processingFolders with localStorage
  const updateProcessingFolders = (folders) => {
    setProcessingFolders(folders);
    localStorage.setItem('processingFolders', JSON.stringify(folders));
  };

  // Color palette for folder cards (excluding processed/green)
const folderColors = [
  'linear-gradient(135deg, #4f46e5, #3b82f6)', // blue
  'linear-gradient(135deg, #059669, #10b981)', // teal
  'linear-gradient(135deg, #d97706, #f59e0b)', // orange
  'linear-gradient(135deg, #7c3aed, #8b5cf6)', // purple
  'linear-gradient(135deg, #dc2626, #ef4444)', // red
  'linear-gradient(135deg, #0ea5e9, #38bdf8)', // sky
  'linear-gradient(135deg, #f43f5e, #f59e42)', // pink-orange
  'linear-gradient(135deg, #14b8a6, #06b6d4)', // cyan
  'linear-gradient(135deg, #a21caf, #f472b6)', // magenta
];

// Deterministic hash for folder name to color index
function getFolderColorIndex(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % folderColors.length;
}

  return (
    <div className="files-section">
      <div className="section-header">
        <h2>Data Processing</h2>
        <p>Process and analyze your uploaded documents by folder</p>
        <button 
          className="refresh-button" 
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh Files'}
        </button>
      </div>
      
      {error && (
        <div className="folders-error">
          <p>{error}</p>
        </div>
      )}
      
      {processingSuccess && (
        <div className="folders-success">
          <p>{processingSuccess.message}</p>
        </div>
      )}
      
      {isLoading ? (
        <div className="folders-loading">
          <p>Loading your folders...</p>
        </div>
      ) : Object.keys(folders).length === 0 ? (
        <div className="folders-empty">
          <p>No folders found. Upload some files to get started.</p>
        </div>
      ) : (
        <div className="folders-grid">
          {Object.values(folders).map((folder) => {
            const processStatus = getFolderProcessStatus(folder.name);
            // If processed, use green; else, random color
            const cardStyle = processStatus.processed
              ? { background: 'linear-gradient(135deg, #059669, #10b981)' }
              : { background: folderColors[getFolderColorIndex(folder.name)] };
            return (
              <div
                key={folder.name}
                className={`folder-card${processStatus.processed ? ' processed-folder' : ''}`}
                style={cardStyle}
                onClick={() => toggleFolder(folder.name)}
              >
                <div className="floating-dot"></div>
                <div className="floating-dot"></div>
                <div className="floating-dot"></div>
                <div className="folder-info">
                  <h3 className="folder-name">{folder.name}</h3>
                  <div className="folder-metadata">
                    <p className="folder-date">Created: {formatDate(folder.creationDate)}</p>
                    <p className="folder-count">{folder.files.length} file(s)</p>
                    {folder.sessionId && <p className="folder-session">Session: {folder.sessionId}</p>}
                  </div>
                </div>
                {processStatus.processed ? (
                  <div className="folder-processed-status">
                    <span className="processed-icon">✓</span>
                    <span className="processed-text">Processed</span>
                    {processStatus.lastUpdated && (
                      <span className="processed-time">
                        {formatDate(processStatus.lastUpdated)}
                      </span>
                    )}
                  </div>
                ) : (
                  <button 
                    className={`process-folder-btn ${processingFolders.includes(folder.name) ? 'processing' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleProcessFolder(folder.name, folder.sessionId);
                    }}
                    disabled={processingFolders.includes(folder.name)}
                  >
                    {processingFolders.includes(folder.name) ? 'Processing...' : 'Process Files'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      
      {/* Folder Files Modal */}
      {selectedFolder && folders[selectedFolder] && (
        <div className="folder-modal-overlay" onClick={() => setSelectedFolder(null)}>
          <div className="folder-modal" onClick={(e) => e.stopPropagation()}>
            <div className="folder-modal-header">
              <h3>{selectedFolder}</h3>
              <button className="close-modal-btn" onClick={() => setSelectedFolder(null)}>×</button>
            </div>
            <div className="folder-modal-content">
              <div className="folder-files-list">
                <table className="folder-files-table">
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Size</th>
                      <th>Uploaded</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {folders[selectedFolder].files.map((file, index) => {
                      console.log('Rendering file row:', file);
                      return (
                        <tr key={index}>
                          <td>{file.fileName}</td>
                          <td>{formatFileSize(file.fileSize)}</td>
                          <td>{formatDate(file.uploadTimestamp)}</td>
                          <td className="file-actions">
                            <button 
                              className="file-delete-btn"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                console.log('Delete button clicked for file:', file);
                                handleDeleteFile(file);
                              }}
                              disabled={file.isDeleting}
                            >
                              {file.isDeleting ? 'Deleting...' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  
  // Helper function to format file size
  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }
};

export default memo(MiddlePanel);
