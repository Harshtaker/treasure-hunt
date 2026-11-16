import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { playSound } from '../lib/sound';

/**
 * Isolated, rock-solid QR Scanner Modal.
 * Wrapped in React.memo so timer updates or parent re-renders do NOT re-initialize or flicker the camera.
 */
function QRScannerModalComponent({ isOpen, onClose, onScanSuccess, soundEnabled = false }) {
  const [cameraError, setCameraError] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const [isReady, setIsReady] = useState(false);

  const scannerRef = useRef(null);
  const isProcessingRef = useRef(false);
  const streamRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);

  const stopAndCleanScanner = useCallback(async () => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }

    const scanner = scannerRef.current;
    scannerRef.current = null;

    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
      } catch (err) {
        // Scanner might already be stopped
      }
      try {
        scanner.clear();
      } catch (err) {}
    }

    // Explicitly shut down any lingering media stream tracks
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch (err) {}
      streamRef.current = null;
    }
  }, []);

  const handleClose = useCallback(async () => {
    playSound('click', soundEnabled);
    await stopAndCleanScanner();
    onClose();
  }, [stopAndCleanScanner, onClose, soundEnabled]);

  const handleDecodedText = useCallback(
    async (decodedText) => {
      // Synchronous lock: drop any subsequent frames immediately
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      const code = String(decodedText || '').trim().toUpperCase();
      if (!code) {
        isProcessingRef.current = false;
        return;
      }

      // Freeze frame if supported
      try {
        await scannerRef.current?.pause(true);
      } catch (err) {}

      // Delegate scan validation to parent
      try {
        const result = await onScanSuccess(code);

        if (result && result.success) {
          setFeedback({ type: 'success', text: result.isFinal ? 'TREASURE UNLOCKED!' : 'SEAL ACCEPTED' });
          playSound('scan-success', soundEnabled);

          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(100);
          }

          feedbackTimeoutRef.current = setTimeout(async () => {
            await stopAndCleanScanner();
            onClose();
          }, 1200);
        } else {
          const errMsg = result?.message || 'INVALID SEAL — TRY AGAIN';
          setFeedback({ type: 'error', text: errMsg });
          playSound('wrong-scan', soundEnabled);

          feedbackTimeoutRef.current = setTimeout(() => {
            setFeedback({ type: '', text: '' });
            isProcessingRef.current = false;
            try {
              scannerRef.current?.resume();
            } catch (err) {}
          }, 1600);
        }
      } catch (err) {
        setFeedback({ type: 'error', text: 'SCAN ERROR — TRY AGAIN' });
        playSound('wrong-scan', soundEnabled);

        feedbackTimeoutRef.current = setTimeout(() => {
          setFeedback({ type: '', text: '' });
          isProcessingRef.current = false;
          try {
            scannerRef.current?.resume();
          } catch (e) {}
        }, 1600);
      }
    },
    [onScanSuccess, stopAndCleanScanner, onClose, soundEnabled]
  );

  useEffect(() => {
    if (!isOpen) return;

    let isCancelled = false;
    isProcessingRef.current = false;
    setFeedback({ type: '', text: '' });
    setCameraError('');
    setIsReady(false);

    const initScanner = async () => {
      // Step 1: Pre-verify camera access and get stream
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera is unavailable. Open this game over HTTPS in a modern browser.');
        return;
      }

      try {
        const testStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        streamRef.current = testStream;
      } catch (err) {
        if (!isCancelled) {
          setCameraError('Camera access denied. Please grant camera permission in your browser and try again.');
        }
        return;
      }

      // Wait a tick for DOM element `#reader-stream` to mount cleanly
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (isCancelled) {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        return;
      }

      const readerElement = document.getElementById('reader-stream');
      if (!readerElement) return;

      try {
        const scanner = new Html5Qrcode('reader-stream', { verbose: false });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 12,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minDim = Math.min(viewfinderWidth, viewfinderHeight);
              const edge = Math.floor(minDim * 0.72);
              return { width: edge, height: edge };
            },
            aspectRatio: 1.0,
          },
          (decoded) => {
            if (!isCancelled) {
              handleDecodedText(decoded);
            }
          },
          () => {
            // Ignore frame-by-frame non-matches
          }
        );

        if (!isCancelled) {
          setIsReady(true);
        }
      } catch (err) {
        if (!isCancelled) {
          setCameraError('Could not start camera feed. Please close other camera apps and try again.');
        }
      }
    };

    initScanner();

    return () => {
      isCancelled = true;
      stopAndCleanScanner();
    };
  }, [isOpen, handleDecodedText, stopAndCleanScanner]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center p-4 bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label="Scan QR Seal"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-[#d9b46e]/60 bg-[#0d1414] p-5 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl text-[#d9b46e]">⌖</span>
            <h2 className="f-h text-lg font-bold text-[#f9e8c5]">ALIGN ANCIENT SEAL</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9b46e]/30 bg-black/40 text-sm text-[#f9e8c5] hover:border-[#d9b46e]"
            aria-label="Close scanner"
          >
            ✕
          </button>
        </div>

        {/* Video Viewport Container */}
        <div className="relative min-h-[300px] w-full overflow-hidden rounded-lg border-2 border-[#d9b46e]/40 bg-black flex items-center justify-center">
          <div id="reader-stream" className="w-full h-full" />

          {/* Loading Indicator */}
          {!isReady && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#d9b46e] border-t-transparent" />
              <p className="f-b text-[10px] tracking-widest text-[#d9b46e]">OPENING EXPEDITION LENS…</p>
            </div>
          )}

          {/* Camera Error Message */}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a0808] p-5 text-center">
              <span className="text-3xl mb-2 text-red-400">⚠</span>
              <p className="f-h text-sm font-bold text-red-200">{cameraError}</p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-5 rounded border border-red-400/40 bg-red-950/40 px-4 py-2 f-b text-xs text-red-200"
              >
                Close Scanner
              </button>
            </div>
          )}

          {/* Scan Feedback Overlay */}
          {feedback.text && (
            <div
              className={`absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center transition-all ${
                feedback.type === 'error' ? 'bg-red-950/90' : 'bg-[#5c4613]/90'
              }`}
            >
              <span className="text-4xl mb-3">{feedback.type === 'error' ? '✖' : '✦'}</span>
              <p className="f-h text-xl font-black uppercase text-white sm:text-2xl">{feedback.text}</p>
            </div>
          )}
        </div>

        {/* Guidance Footer */}
        <div className="mt-4 flex items-center justify-between text-[10px] text-white/50 f-b">
          <span>Target QR code inside box</span>
          <button
            type="button"
            onClick={handleClose}
            className="text-[#d9b46e] underline hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export const QRScannerModal = memo(QRScannerModalComponent);
export default QRScannerModal;
