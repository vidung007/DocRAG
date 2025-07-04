import React, { useState } from 'react';
import './ReferencePopup.css';

const ReferencePopup = ({ 
  fieldInfo, 
  references, 
  onClose, 
  onOpenPDF 
}) => {
  const [selectedReference, setSelectedReference] = useState(0);
  const [showAllReferences, setShowAllReferences] = useState(false);

  if (!fieldInfo || !references || references.length === 0) {
    return null;
  }

  const currentReference = references[selectedReference];
  
  // Extract file name from S3 URI
  const extractFileName = (s3Uri) => {
    if (!s3Uri) return 'Unknown File';
    try {
      let path = s3Uri;
      if (s3Uri.startsWith('s3://')) {
        path = s3Uri.replace(/^s3:\/\/[^/]+\//, '');
      }
      const fileName = path.split('/').pop();
      return fileName.replace(/::chunk-\d+$/, '');
    } catch (error) {
      return 'Unknown File';
    }
  };

  // Get unique documents
  const getUniqueDocuments = () => {
    const docs = new Map();
    references.forEach((ref, index) => {
      const fileName = extractFileName(ref.metadata?.original_s3_key);
      if (!docs.has(fileName)) {
        docs.set(fileName, []);
      }
      docs.get(fileName).push({ ...ref, originalIndex: index });
    });
    return docs;
  };

  const uniqueDocuments = getUniqueDocuments();

  return (
    <div className="reference-popup-overlay" onClick={onClose}>
      <div className="reference-popup-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="popup-header">
          <div className="popup-title">
            <h3>📋 Field References</h3>
            <p className="field-name">{fieldInfo.fieldLabel}</p>
          </div>
          <button className="popup-close-btn" onClick={onClose}>×</button>
        </div>

        {/* Reference Summary */}
        <div className="reference-summary">
          <div className="summary-stats">
            <div className="stat-item">
              <span className="stat-number">{references.length}</span>
              <span className="stat-label">Reference{references.length > 1 ? 's' : ''}</span>
            </div>
            <div className="stat-item">
              <span className="stat-number">{uniqueDocuments.size}</span>
              <span className="stat-label">Document{uniqueDocuments.size > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>

        {/* Document Tabs */}
        {uniqueDocuments.size > 1 && (
          <div className="document-tabs">
            {Array.from(uniqueDocuments.keys()).map((fileName, index) => (
              <button
                key={fileName}
                className={`doc-tab ${selectedReference === uniqueDocuments.get(fileName)[0].originalIndex ? 'active' : ''}`}
                onClick={() => setSelectedReference(uniqueDocuments.get(fileName)[0].originalIndex)}
              >
                📄 {fileName}
                <span className="ref-count">({uniqueDocuments.get(fileName).length})</span>
              </button>
            ))}
          </div>
        )}

        {/* Main Content */}
        <div className="popup-content">
          {/* Current Reference Details */}
          <div className="reference-details">
            <div className="reference-header">
              <h4>
                Reference {selectedReference + 1} of {references.length}
                {references.length > 1 && (
                  <div className="reference-nav">
                    <button 
                      onClick={() => setSelectedReference(Math.max(0, selectedReference - 1))}
                      disabled={selectedReference === 0}
                      className="nav-btn prev"
                    >
                      ← Previous
                    </button>
                    <button 
                      onClick={() => setSelectedReference(Math.min(references.length - 1, selectedReference + 1))}
                      disabled={selectedReference === references.length - 1}
                      className="nav-btn next"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </h4>
            </div>

            {/* Source Document Info */}
            <div className="source-info">
              <div className="source-file">
                <strong>📄 Source:</strong> {extractFileName(currentReference.metadata?.original_s3_key)}
              </div>
              {currentReference.metadata?.page_numbers && (
                <div className="page-info">
                  <strong>📖 Pages:</strong> {currentReference.metadata.page_numbers}
                </div>
              )}
              {currentReference.metadata?.document_title && (
                <div className="doc-title">
                  <strong>📋 Title:</strong> {currentReference.metadata.document_title}
                </div>
              )}
            </div>

            {/* Content Preview */}
            <div className="content-preview">
              <h5>Content Extract:</h5>
              <div className="content-text">
                {currentReference.content?.text || 'No content preview available'}
              </div>
            </div>

            {/* Actions */}
            <div className="reference-actions">
              {currentReference.metadata?.original_s3_key?.toLowerCase().includes('.pdf') && (
                <button 
                  className="action-btn primary"
                  onClick={() => {                    if (onOpenPDF) {
                      // Prepare PDF info for the highlighter
                      let bboxHighlights = [];
                        // Handle new bounding box format
                      if (currentReference.metadata.bounding_boxes) {
                        try {
                          const boundingBoxes = JSON.parse(currentReference.metadata.bounding_boxes);
                          bboxHighlights = boundingBoxes.map(bbox => ({
                            page: bbox.page,
                            bbox_left: bbox.left,
                            bbox_top: bbox.top,
                            bbox_width: bbox.width,
                            bbox_height: bbox.height,
                            color: 'rgba(255, 255, 0, 0.4)'
                          }));
                        } catch (e) {
                          console.warn('Failed to parse new bounding_boxes format:', e);
                        }
                      }
                      
                      // Fallback to legacy format if no new format available
                      if (bboxHighlights.length === 0 && currentReference.metadata.bbox_left !== undefined) {
                        bboxHighlights = [{
                          bbox_left: parseFloat(currentReference.metadata.bbox_left),
                          bbox_top: parseFloat(currentReference.metadata.bbox_top),
                          bbox_width: parseFloat(currentReference.metadata.bbox_width || 0.1),
                          bbox_height: parseFloat(currentReference.metadata.bbox_height || 0.05),
                          color: 'rgba(255, 255, 0, 0.4)'
                        }];
                      }
                      
                      const pdfInfo = {
                        pdfUrl: currentReference.metadata.original_s3_key,
                        pageNumber: currentReference.metadata.page_numbers ? 
                          parseInt(currentReference.metadata.page_numbers.split(',')[0]) : 1,
                        citationPageNumbers: currentReference.metadata.page_numbers,
                        bboxHighlights: bboxHighlights,
                        fileName: extractFileName(currentReference.metadata.original_s3_key),
                        metadata: currentReference.metadata // Pass full metadata for fallback handling
                      };
                      onOpenPDF(pdfInfo);
                      onClose(); // Close popup when opening PDF
                    }
                  }}
                >
                  🔍 View in PDF
                </button>
              )}
              
              {currentReference.location?.s3Location?.uri && (
                <button 
                  className="action-btn secondary"
                  onClick={() => window.open(currentReference.location.s3Location.uri, '_blank')}
                >
                  🔗 Direct Link
                </button>
              )}
            </div>
          </div>

          {/* All References List (collapsible) */}
          {references.length > 1 && (
            <div className="all-references-section">
              <button 
                className="toggle-all-refs"
                onClick={() => setShowAllReferences(!showAllReferences)}
              >
                {showAllReferences ? '▼' : '▶'} View All {references.length} References
              </button>
              
              {showAllReferences && (
                <div className="all-references-list">
                  {references.map((ref, index) => (
                    <div 
                      key={index} 
                      className={`ref-item ${index === selectedReference ? 'selected' : ''}`}
                      onClick={() => setSelectedReference(index)}
                    >
                      <div className="ref-item-header">
                        <span className="ref-number">#{index + 1}</span>
                        <span className="ref-file">{extractFileName(ref.metadata?.original_s3_key)}</span>
                        {ref.metadata?.page_numbers && (
                          <span className="ref-pages">Pages: {ref.metadata.page_numbers}</span>
                        )}
                      </div>
                      <div className="ref-item-preview">
                        {(ref.content?.text || '').substring(0, 100)}...
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="popup-footer">
          <div className="footer-info">
            <small>💡 Click "View in PDF" to see highlighted content with bbox coordinates</small>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReferencePopup;
