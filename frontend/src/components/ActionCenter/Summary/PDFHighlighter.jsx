import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import './PDFHighlighter.css';

// Configure PDF.js worker to use local file
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL}/pdf.worker.min.js`;

const PDFHighlighter = ({ 
  pdfUrl, 
  pageNumber = 1, 
  bboxHighlights = [], // Array of { bbox_left, bbox_top, bbox_width, bbox_height, color? }
  citationPageNumbers = null, // String like "2, 3, 4" or array of page numbers
  onClose 
}) => {
  
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null); // Track current render task
  const debounceTimeoutRef = useRef(null); // For debouncing renders
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(pageNumber);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);  const [error, setError] = useState(null);
  const [scale, setScale] = useState(1.0);
  const [rendering, setRendering] = useState(false);
  const [pageRendering, setPageRendering] = useState(false); // Track page-specific rendering
  // Parse and store the specific pages to show
  const [allowedPages, setAllowedPages] = useState([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0); // Index in allowedPages array
  const [showFullPDF, setShowFullPDF] = useState(false); // Toggle between citation pages and full PDF
    // Parse citation page numbers and set initial state
  useEffect(() => {

    if (citationPageNumbers) {
      let pages = [];
      
      if (typeof citationPageNumbers === 'string') {
        // Parse string like "2, 3, 4, 5, 6, 7, 8, 9, 10, 11"
        pages = citationPageNumbers
          .split(',')
          .map(p => parseInt(p.trim()))
          .filter(p => !isNaN(p))
          .sort((a, b) => a - b); // Sort numerically
      } else if (Array.isArray(citationPageNumbers)) {
        pages = citationPageNumbers.map(p => parseInt(p)).filter(p => !isNaN(p)).sort((a, b) => a - b);
      }
      
      if (pages.length > 0) {
        setAllowedPages(pages);
        // Find the index of the initial page number in allowed pages
        const initialPageIndex = pages.findIndex(p => p === pageNumber);
        const targetIndex = Math.max(0, initialPageIndex >= 0 ? initialPageIndex : 0);
        setCurrentPageIndex(targetIndex);
        setCurrentPage(pages[targetIndex]);

      } else {
        // If no specific pages, show all pages
        setAllowedPages([]);
        setCurrentPageIndex(0);
        setCurrentPage(pageNumber);
      }
    } else {
      // No citation pages specified, show all pages
      setAllowedPages([]);
      setCurrentPageIndex(0);
      setCurrentPage(pageNumber);
    }
  }, [citationPageNumbers, pageNumber]);
    // Load PDF document
  useEffect(() => {
    const loadPDF = async () => {
      try {
        setLoading(true);
        setError(null);

        
        // Configure PDF loading options for better performance and S3 compatibility
        const pdfLoadOptions = {
          url: pdfUrl,
          // Enable range requests for faster loading of specific pages
          disableRange: false,
          // Enable progressive loading
          disableStream: false,
          // Use worker for better performance
          useWorkerFetch: true
        };
        
        const loadingTask = pdfjsLib.getDocument(pdfLoadOptions);
        
        const pdf = await loadingTask.promise;
        

        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        
        // Don't set initial page here - let the citation page effect handle it
        
      } catch (err) {
        console.error('❌ Error loading PDF:', err);
        let errorMessage = 'Failed to load PDF';
        
        if (err.message.includes('CORS')) {
          errorMessage = 'Failed to load PDF: CORS error. The PDF file may not be accessible from this domain.';
        } else if (err.message.includes('404') || err.message.includes('Not Found')) {
          errorMessage = 'Failed to load PDF: File not found. The PDF may have been moved or deleted.';
        } else if (err.message.includes('403') || err.message.includes('Forbidden')) {
          errorMessage = 'Failed to load PDF: Access denied. You may not have permission to view this file.';
        } else {
          errorMessage = `Failed to load PDF: ${err.message}`;
        }
        
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    if (pdfUrl) {
      loadPDF();
    }
  }, [pdfUrl]); // Only depend on pdfUrl// Render current page with highlights
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current || pageRendering) return;

      // Cancel any existing render task
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (err) {
          // Ignore cancellation errors
        }
        renderTaskRef.current = null;
      }      try {
        setPageRendering(true);
        console.log('🎨 Rendering page:', currentPage);
        
        // Only get the specific page we need, not the whole document
        const page = await pdfDoc.getPage(currentPage);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        // Calculate scale based on container size
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth - 40; // Account for padding
        const viewport = page.getViewport({ scale: 1.0 });
        const calculatedScale = Math.min(containerWidth / viewport.width, scale);
        
        const scaledViewport = page.getViewport({ scale: calculatedScale });

        // Set canvas dimensions
        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;

        // Clear canvas completely
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = 'white'; // Set white background
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Render only this specific page
        const renderContext = {
          canvasContext: context,
          viewport: scaledViewport,
          // Enable text layer for better performance
          enableWebGL: false,
          // Render in high quality but optimized
          intent: 'display'
        };

        // Store the render task so we can cancel it if needed
        renderTaskRef.current = page.render(renderContext);
        await renderTaskRef.current.promise;
        
        // Clear the render task reference
        renderTaskRef.current = null;

        // Draw bbox highlights only after page is fully rendered
        if (bboxHighlights.length > 0) {
          drawHighlights(context, scaledViewport, bboxHighlights);
        }
        
        // Clean up the page object to free memory
        page.cleanup();
        
      } catch (err) {
        // Only show error if it's not a cancellation
        if (err.name !== 'RenderingCancelledException') {
          console.error('Error rendering page:', err);
          setError('Failed to render page: ' + err.message);
        }
      } finally {
        setPageRendering(false);
      }
    };

    // Add a small delay to prevent rapid re-renders
    const timeoutId = setTimeout(() => {
      if (!pageRendering) {
        renderPage();
      }
    }, 50);

    return () => {
      clearTimeout(timeoutId);
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (err) {
          // Ignore cancellation errors
        }
        renderTaskRef.current = null;
      }
      
      // Clear debounce timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    };
  }, [pdfDoc, currentPage, scale, bboxHighlights]); // Dependencies without rendering states

  // Cleanup effect for component unmount
  useEffect(() => {
    return () => {
      // Cancel any ongoing render tasks
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (err) {
          // Ignore cancellation errors
        }
      }
      
      // Clear any debounce timeouts
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);  // Draw highlight rectangles on the canvas
  const drawHighlights = (context, viewport, highlights) => {
    // Filter highlights for current page
    const pageHighlights = highlights.filter(highlight => {
      // New format: highlight has a page property
      if (highlight.page !== undefined) {
        return highlight.page === currentPage;
      }
      // Legacy format: no page property means highlight applies to current page
      return true;
    });
    
    pageHighlights.forEach((highlight, index) => {
      const { bbox_left, bbox_top, bbox_width, bbox_height, color = 'rgba(255, 255, 0, 0.3)' } = highlight;
      
      // Convert normalized coordinates (0-1) to canvas coordinates
      const x = bbox_left * viewport.width;
      const y = bbox_top * viewport.height;
      const width = bbox_width * viewport.width;
      const height = bbox_height * viewport.height;

      // Draw highlight rectangle
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
      
      // Draw border
      context.strokeStyle = color.replace('0.3', '0.8');
      context.lineWidth = 2;
      context.strokeRect(x, y, width, height);
      
      // Add highlight number
      context.fillStyle = 'rgba(0, 0, 0, 0.8)';
      context.font = '12px Arial';
      context.fillText(`${index + 1}`, x + 5, y + 15);
    });
  };// Navigation handlers with citation page restrictions
  const goToPage = (pageNumOrIndex) => {
    if (pageRendering) return; // Don't navigate while rendering
    
    // Check if we should use citation page restrictions
    const useCitationRestrictions = !showFullPDF && allowedPages.length > 0;
    
    if (useCitationRestrictions) {
      // Navigate within allowed pages only
      let newIndex;
      
      if (typeof pageNumOrIndex === 'string') {
        // User typed a page number directly
        const pageNum = parseInt(pageNumOrIndex);
        newIndex = allowedPages.findIndex(p => p === pageNum);
        if (newIndex === -1) {
          console.log('❌ Page', pageNum, 'not in allowed pages:', allowedPages);
          return; // Page not allowed
        }
      } else {
        // Navigation by index
        newIndex = pageNumOrIndex;
      }
      
      if (newIndex >= 0 && newIndex < allowedPages.length && newIndex !== currentPageIndex) {
        console.log('🔄 Navigating to page index:', newIndex, 'page:', allowedPages[newIndex]);
        setCurrentPageIndex(newIndex);
        setCurrentPage(allowedPages[newIndex]);
      }
    } else {
      // Normal navigation for full PDF
      const page = Math.min(Math.max(1, parseInt(pageNumOrIndex)), numPages);
      if (page !== currentPage) {
        console.log('🔄 Navigating to page:', page);
        setCurrentPage(page);
      }
    }
  };
    const goToPreviousPage = () => {
    const useCitationRestrictions = !showFullPDF && allowedPages.length > 0;
    
    if (useCitationRestrictions) {
      goToPage(currentPageIndex - 1);
    } else {
      goToPage(currentPage - 1);
    }
  };
  
  const goToNextPage = () => {
    const useCitationRestrictions = !showFullPDF && allowedPages.length > 0;
    
    if (useCitationRestrictions) {
      goToPage(currentPageIndex + 1);
    } else {
      goToPage(currentPage + 1);
    }
  };

  const canGoPrevious = () => {
    const useCitationRestrictions = !showFullPDF && allowedPages.length > 0;
    
    if (useCitationRestrictions) {
      return currentPageIndex > 0;
    } else {
      return currentPage > 1;
    }
  };
  
  const canGoNext = () => {
    const useCitationRestrictions = !showFullPDF && allowedPages.length > 0;
    
    if (useCitationRestrictions) {
      return currentPageIndex < allowedPages.length - 1;
    } else {
      return currentPage < numPages;
    }
  };
  const zoomIn = () => {
    if (!pageRendering) {
      setScale(prev => Math.min(prev + 0.25, 3.0));
    }
  };
  
  const zoomOut = () => {
    if (!pageRendering) {
      setScale(prev => Math.max(prev - 0.25, 0.5));
    }
  };
  
  const resetZoom = () => {
    if (!pageRendering) {
      setScale(1.0);
    }
  };


  if (loading) {
    return (
      <div className="pdf-highlighter-overlay">
        <div className="pdf-highlighter-modal">
          <div className="pdf-loading">
            <div className="spinner"></div>
            <p>Loading PDF...</p>
          </div>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="pdf-highlighter-overlay" onClick={onClose}>
        <div className="pdf-highlighter-modal" onClick={(e) => e.stopPropagation()}>
          <div className="pdf-error">
            <h3>❌ Error Loading PDF</h3>
            <p>{error}</p>
            <div style={{ marginTop: '1rem' }}>
              <button onClick={onClose} className="close-btn" style={{ 
                background: '#dc3545', 
                color: 'white', 
                border: 'none', 
                padding: '0.5rem 1rem', 
                borderRadius: '4px',
                cursor: 'pointer'
              }}>
                Close
              </button>
            </div>
            <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#666' }}>
              <p><strong>Troubleshooting tips:</strong></p>
              <ul style={{ textAlign: 'left', marginTop: '0.5rem' }}>
                <li>Check if the PDF file exists and is accessible</li>
                <li>Verify that the S3 bucket has the correct CORS configuration</li>
                <li>Ensure the PDF file is not corrupted</li>
                <li>Try refreshing the page</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-highlighter-overlay" onClick={onClose}>
      <div className="pdf-highlighter-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-header">          <div className="pdf-title">
            <h3>PDF Source Document</h3>
            <span className="page-info">
              {!showFullPDF && allowedPages.length > 0 ? (
                <>
                  Page {currentPage} ({currentPageIndex + 1} of {allowedPages.length} citation pages)
                  <br />
                  <small>Showing pages: {allowedPages.join(', ')}</small>
                </>
              ) : (
                <>Page {currentPage} of {numPages}</>
              )}
              {bboxHighlights.length > 0 && <span className="highlights-info"> • {bboxHighlights.length} highlight(s)</span>}
            </span>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="pdf-toolbar">
          {/* Citation Pages Toggle */}
          {allowedPages.length > 0 && (
            <div className="citation-toggle">
              <label>
                <input 
                  type="checkbox" 
                  checked={showFullPDF} 
                  onChange={(e) => setShowFullPDF(e.target.checked)}
                />
                Show Full PDF
              </label>
            </div>
          )}
          
          <div className="page-controls">            <button 
              onClick={goToPreviousPage} 
              disabled={!canGoPrevious() || pageRendering}
              className="nav-btn"
            >
              Previous
            </button>            <input 
              type="number" 
              value={currentPage} 
              onChange={(e) => {
                const value = e.target.value;
                if (value && !isNaN(value)) {
                  goToPage(value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.target.blur(); // Remove focus to prevent further typing
                }
              }}
              min={!showFullPDF && allowedPages.length > 0 ? Math.min(...allowedPages) : 1} 
              max={!showFullPDF && allowedPages.length > 0 ? Math.max(...allowedPages) : numPages}
              className="page-input"
              title={!showFullPDF && allowedPages.length > 0 ? `Available pages: ${allowedPages.join(', ')}` : ''}
              disabled={pageRendering}
            /><button 
              onClick={goToNextPage} 
              disabled={!canGoNext() || pageRendering}
              className="nav-btn"
            >
              Next
            </button>
          </div>
            <div className="zoom-controls">
            <button onClick={zoomOut} className="zoom-btn" disabled={pageRendering}>-</button>
            <span className="zoom-level">{Math.round(scale * 100)}%</span>
            <button onClick={zoomIn} className="zoom-btn" disabled={pageRendering}>+</button>
            <button onClick={resetZoom} className="reset-btn" disabled={pageRendering}>Reset</button>
          </div>
        </div>
          <div className="pdf-content">
          {pageRendering && (
            <div className="page-loading-overlay">
              <div className="page-spinner"></div>
              <span>Rendering page...</span>
            </div>
          )}
          <canvas ref={canvasRef} className="pdf-canvas" />
        </div>
        
        {bboxHighlights.length > 0 && (
          <div className="highlights-legend">
            <h4>Highlighted Sections:</h4>
            <div className="legend-items">
              {bboxHighlights.map((highlight, index) => (
                <div key={index} className="legend-item">
                  <div 
                    className="legend-color" 
                    style={{ backgroundColor: highlight.color || 'rgba(255, 255, 0, 0.3)' }}
                  ></div>
                  <span>Section {index + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFHighlighter;
