import React, { useRef, useState, useEffect } from 'react';
import { Camera, StopCircle, Play, X, Loader } from 'lucide-react';

type ValidationStep = 'initial' | 'ready' | 'leftHand' | 'rightHand' | 'bothHands' | 'completed' | 
  'Closed_Fist' | 'Open_Palm' | 'Thumb_Down' | 'Thumb_Up';

type GestureType = 'Closed_Fist' | 'Open_Palm' | 'Thumb_Down' | 'Thumb_Up';
type HandRaiseType = 'leftHand' | 'rightHand' | 'bothHands';

const GESTURES: GestureType[] = ['Closed_Fist', 'Open_Palm', 'Thumb_Down', 'Thumb_Up'];
const HAND_RAISE_STEPS: HandRaiseType[] = ['leftHand', 'rightHand', 'bothHands'];

// Combine all possible validation steps
const ALL_VALIDATION_STEPS = [...HAND_RAISE_STEPS, ...GESTURES];

// Visual symbols for each action
const ACTION_SYMBOLS = {
  leftHand: '👈 ✋',
  rightHand: '✋ 👉',
  bothHands: '🙌',
  Closed_Fist: '✊',
  Open_Palm: '✋',
  Thumb_Down: '👎',
  Thumb_Up: '👍'
} as const;

// Helper function to get action description with symbol
const getActionDescription = (step: ValidationStep): string => {
  switch (step) {
    case 'leftHand':
      return `Raise Your Left Hand ${ACTION_SYMBOLS.leftHand}`;
    case 'rightHand':
      return `Raise Your Right Hand ${ACTION_SYMBOLS.rightHand}`;
    case 'bothHands':
      return `Raise Both Hands ${ACTION_SYMBOLS.bothHands}`;
    case 'Closed_Fist':
      return `Make a Closed Fist ${ACTION_SYMBOLS.Closed_Fist}`;
    case 'Open_Palm':
      return `Show Open Palm ${ACTION_SYMBOLS.Open_Palm}`;
    case 'Thumb_Down':
      return `Show Thumbs Down ${ACTION_SYMBOLS.Thumb_Down}`;
    case 'Thumb_Up':
      return `Show Thumbs Up ${ACTION_SYMBOLS.Thumb_Up}`;
    default:
      return '';
  }
};

// Fisher-Yates shuffle algorithm
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

interface FrameBatch {
  frames: string[];
  timestamp: number;
  batch_number: number;
}

interface WebSocketMessage {
  type: 'frames' | 'validation_result' | 'error' | 'connection_status';
  data: {
    frames?: string[];
    validation_step?: ValidationStep;
    timestamp?: number;
    batch_number?: number;
    gesture_recognize?: boolean;
    validation?: string;
    message?: string;
    status?: string;
  };
}

const VideoTest: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const sendIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const batchNumberRef = useRef<number>(0);
  const currentStepRef = useRef<ValidationStep>('initial');
  const frameBufferRef = useRef<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  
  const [currentStep, setCurrentStep] = useState<ValidationStep>('initial');
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [remainingTime, setRemainingTime] = useState<number>(7);
  const [isLoading, setIsLoading] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showPrompt, setShowPrompt] = useState<boolean>(false);
  const [promptMessage, setPromptMessage] = useState<string>('');
  const [showNextButton, setShowNextButton] = useState<boolean>(false);
  const [randomizedSteps, setRandomizedSteps] = useState<ValidationStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);

  // Constants for timing
  const READY_DELAY = 3000; // 3 seconds get ready time
  const MAX_VALIDATION_TIME = 9000; // 9 seconds max validation time
  const FRAME_RATE = 24; // 24fps capture rate
  const FRAMES_TO_SEND = 10; // Send 10 frames per second
  const FRAME_INTERVAL = Math.floor(1000 / FRAME_RATE); // ~41.67ms between captures
  const SEND_INTERVAL = 1000; // Send batch every second

  // Keep currentStepRef in sync with currentStep state
  useEffect(() => {
    currentStepRef.current = currentStep;
    console.log('[State Change] Current step changed to:', currentStep);
  }, [currentStep]);

  // Initialize randomized steps
  useEffect(() => {
    // Select 3 random steps from all possible validation steps
    const shuffledSteps = shuffleArray(ALL_VALIDATION_STEPS).slice(0, 3);
    console.log('[Initialization] Randomized validation steps:', shuffledSteps);
    setRandomizedSteps(shuffledSteps);
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    console.log('[Cleanup] Starting cleanup process');
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      console.log('[Cleanup] Camera tracks stopped');
    }
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      console.log('[Cleanup] Frame capture interval cleared');
    }
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      console.log('[Cleanup] Send interval cleared');
    }
    setIsCapturing(false);
    setIsCameraActive(false);
    setStatus('');
    startTimeRef.current = 0;
    batchNumberRef.current = 0;
    frameBufferRef.current = [];
    console.log('[Cleanup] Cleanup completed');
  };

  const captureFrame = async (): Promise<string | null> => {
    if (!videoRef.current || !canvasRef.current) {
      console.log('[Frame Capture] Failed - video or canvas ref not available');
      return null;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    
    if (!context) {
      console.log('[Frame Capture] Failed - could not get canvas context');
      return null;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const frame = canvas.toDataURL('image/jpeg', 0.8);
    console.log('[Frame Capture] Frame captured successfully');
    return frame;
  };

  const selectFramesToSend = (frames: string[]): string[] => {
    if (frames.length <= FRAMES_TO_SEND) return frames;
    
    const result: string[] = [];
    // Calculate the step size to get evenly spaced frames
    const step = Math.floor(frames.length / FRAMES_TO_SEND);
    
    // Select evenly spaced frames
    for (let i = 0; i < FRAMES_TO_SEND && i * step < frames.length; i++) {
      result.push(frames[i * step]);
    }
    
    return result;
  };

  const resetValidationState = () => {
    setStatus('');
    setCountdown(null);
    setShowPrompt(false);
    setPromptMessage('');
    setShowNextButton(false);
    setRemainingTime(9);
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
    frameBufferRef.current = [];
    batchNumberRef.current = 0;
    startTimeRef.current = 0;
  };

  const isHandRaiseStep = (step: ValidationStep): boolean => {
    return step === 'leftHand' || step === 'rightHand' || step === 'bothHands';
  };

  const isGestureStep = (step: ValidationStep): boolean => {
    return GESTURES.includes(step as GestureType);
  };

  // WebSocket connection setup
  useEffect(() => {
    let reconnectTimeout: number | null = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;

    const connectWebSocket = () => {
      console.log('[WebSocket] Attempting to connect...');
      setWsStatus('connecting');
      
      // Use Vite proxy
      const ws = new WebSocket('ws://localhost:5173/ws/video/');
      
      ws.onopen = () => {
        console.log('[WebSocket] Connection established');
        setWsStatus('connected');
        setError('');
        reconnectAttempts = 0;
      };

      ws.onclose = (event) => {
        console.log('[WebSocket] Connection closed', event.code, event.reason);
        setWsStatus('disconnected');
        
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`[WebSocket] Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          reconnectTimeout = window.setTimeout(connectWebSocket, 3000);
        } else {
          console.log('[WebSocket] Max reconnection attempts reached');
          setError('Failed to establish WebSocket connection. Please refresh the page.');
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Connection error:', error);
        setWsStatus('disconnected');
        setError('WebSocket connection error. Please try again.');
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          if (message.type === 'connection_status') {
            console.log('[WebSocket] Connection status:', message.data.status);
            return;
          }
          
          if (message.type === 'validation_result') {
            console.log('%c[Validation Result]', 'color: #FF9800; font-weight: bold', {
              validation: message.data.validation,
              step: message.data.validation_step,
              timestamp: new Date().toISOString()
            });
            handleValidationResult(message.data);
          } else if (message.type === 'error') {
            console.error('%c[WebSocket Error]', 'color: #F44336; font-weight: bold', {
              message: message.data.message,
              timestamp: new Date().toISOString()
            });
            setError(message.data.message || 'An error occurred');
          }
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      };

      wsRef.current = ws;
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (wsRef.current) {
        console.log('[WebSocket] Closing connection on cleanup');
        wsRef.current.close();
      }
    };
  }, []);

  const handleValidationResult = (data: WebSocketMessage['data']) => {
    console.log('[Validation] Received validation result:', data);
    
    if (data.validation === 'validated') {
      console.log(`[Validation] Step ${currentStepRef.current} validated successfully`);
      stopCapturing();
      resetValidationState();
      
      const currentIndex = currentStepIndex;
      const isLastStep = currentIndex === randomizedSteps.length - 1;
      
      if (isLastStep) {
        setShowPrompt(true);
        setPromptMessage('All validations completed successfully!');
        setShowNextButton(true);
        setCurrentStep('completed');
      } else {
        setShowPrompt(true);
        setPromptMessage(`${currentStepRef.current} validated! Ready for next validation step?`);
        setShowNextButton(true);
      }
    } else if (data.validation === 'not_validated') {
      console.log(`[Validation] Step ${currentStepRef.current} validation failed`);
      setStatus(`Please ${getActionDescription(currentStepRef.current)}`);
    }
  };

  const sendFrameBatch = async (batch: FrameBatch) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[WebSocket] Failed to send batch - WebSocket not connected');
      setError('WebSocket connection not established. Please try again.');
      return;
    }

    try {
      const selectedFrames = selectFramesToSend(batch.frames);
      console.log(`[WebSocket] Sending batch ${batch.batch_number} with ${selectedFrames.length} frames`);
      
      const message: WebSocketMessage = {
        type: 'frames',
        data: {
          frames: selectedFrames,
          validation_step: currentStepRef.current,
          timestamp: batch.timestamp,
          batch_number: batch.batch_number,
          gesture_recognize: isGestureStep(currentStepRef.current)
        }
      };

      wsRef.current.send(JSON.stringify(message));
      console.log('[WebSocket] Batch sent successfully');
    } catch (err) {
      console.error('[WebSocket] Failed to send frame batch:', err);
      setStatus('Failed to send frames');
    }
  };

  const startCamera = async () => {
    try {
      console.log('[Camera] Starting camera initialization');
      setError('');
      setIsLoading(true);
      setStatus('Initializing camera...');

      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24 }
        }, 
        audio: false 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        console.log('[Camera] Video stream attached to video element');
      }
      streamRef.current = stream;
      setStatus('Camera ready');
      setIsCameraActive(true);
      setCurrentStep('ready');
      console.log('[Camera] Camera initialized successfully');

    } catch (err) {
      console.error('[Camera] Error accessing media devices:', err);
      setError('Failed to access camera. Please ensure you have granted camera permissions.');
    } finally {
      setIsLoading(false);
    }
  };

  const startValidation = () => {
    if (!streamRef.current) {
      console.error('[Validation] Failed to start - camera not initialized');
      setError('Camera not initialized');
      return;
    }

    console.log('[Validation] Starting validation process');
    resetValidationState();
    setCurrentStepIndex(0);
    const firstStep = randomizedSteps[0];
    setCurrentStep(firstStep);
    console.log(`[Validation] First step set to: ${firstStep}`);
    setStatus(`Please ${getActionDescription(firstStep)}`);
    startCapturing();
  };

  const startCapturing = () => {
    if (wsStatus !== 'connected') {
      console.error('[Capture] Failed to start - WebSocket not connected');
      setError('WebSocket connection not established. Please try again.');
      return;
    }

    console.log('[Capture] Starting capture process');
    setIsCapturing(true);
    frameBufferRef.current = [];
    batchNumberRef.current = 0;
    
    setStatus('Get ready... Starting in 3 seconds');
    setCountdown(3);
    
    setTimeout(() => {
      console.log('[Capture] Starting frame capture');
      startTimeRef.current = Date.now();
      setStatus('Capturing and validating...');
      setCountdown(null);
      
      frameIntervalRef.current = window.setInterval(async () => {
        const frame = await captureFrame();
        if (frame) {
          frameBufferRef.current.push(frame);
        }
      }, FRAME_INTERVAL);

      let lastSendTime = Date.now();
      sendIntervalRef.current = window.setInterval(async () => {
        const currentTime = Date.now();
        const timeSinceLastSend = currentTime - lastSendTime;
        
        if (timeSinceLastSend >= SEND_INTERVAL) {
          const elapsedTime = currentTime - startTimeRef.current;
          
          if (elapsedTime >= MAX_VALIDATION_TIME) {
            console.log('[Capture] Validation timeout reached');
            stopCapturing();
            resetValidationState();
            setStatus('Validation timeout. Please try again.');
            setCurrentStep('ready');
            return;
          }

          if (frameBufferRef.current.length > 0) {
            batchNumberRef.current++;
            const batch: FrameBatch = {
              frames: frameBufferRef.current,
              timestamp: currentTime,
              batch_number: batchNumberRef.current
            };
            frameBufferRef.current = [];
            lastSendTime = currentTime;
            await sendFrameBatch(batch);
          }
        }
      }, 100);
    }, READY_DELAY);
  };

  const stopCapturing = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
    setIsCapturing(false);
  };

  const stopCamera = () => {
    cleanup();
    setCurrentStep('initial');
  };

  // Add countdown effect
  useEffect(() => {
    let timer: number;
    if (countdown !== null && countdown > 0) {
      timer = window.setTimeout(() => {
        setCountdown(prev => prev !== null ? prev - 1 : null);
      }, 1000);
    }
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [countdown]);

  // Add timer update effect
  useEffect(() => {
    let timerInterval: number;
    
    if (isCapturing && remainingTime > 0) {
      timerInterval = window.setInterval(() => {
        setRemainingTime(prev => {
          if (prev <= 1) {
            stopCapturing();
            resetValidationState();
            setStatus('Validation timeout. Please try again.');
            setCurrentStep('ready');
            return 7;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerInterval) {
        clearInterval(timerInterval);
      }
    };
  }, [isCapturing]);

  const handleNextStep = () => {
    setShowPrompt(false);
    setShowNextButton(false);

    const nextIndex = currentStepIndex + 1;
    setCurrentStepIndex(nextIndex);

    if (nextIndex < randomizedSteps.length) {
      const nextStep = randomizedSteps[nextIndex];
      setCurrentStep(nextStep);
      setStatus(`Please ${getActionDescription(nextStep)}`);
      startCapturing();
    } else {
      setCurrentStep('completed');
    }
  };

  // Add WebSocket status indicator to the UI
  const renderWebSocketStatus = () => {
    if (wsStatus === 'connecting') {
      return (
        <div className="absolute top-4 right-4 bg-yellow-500 text-white px-3 py-1 rounded-full text-sm">
          Connecting...
        </div>
      );
    } else if (wsStatus === 'disconnected') {
      return (
        <div className="absolute top-4 right-4 bg-red-500 text-white px-3 py-1 rounded-full text-sm">
          Disconnected
        </div>
      );
    }
    return null;
  };

  const renderContent = () => {
    switch (currentStep) {
      case 'initial':
        return (
          <div className="text-center p-8">
            <h2 className="text-2xl font-bold mb-4">Video Validation Test</h2>
            <p className="text-gray-600 mb-6">
              Please ensure you are in a well-lit environment and have enough space to move your arms.
              Face the camera directly and make sure your upper body is clearly visible.
              You will need to complete 3 random validation steps.
            </p>
            <button
              onClick={startCamera}
              disabled={isLoading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center">
                  <Loader className="w-5 h-5 animate-spin mr-2" />
                  Initializing...
                </span>
              ) : (
                "Start Validation"
              )}
            </button>
          </div>
        );

      case 'ready':
        return (
          <div className="text-center">
            <button
              onClick={startValidation}
              className="mt-4 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              Begin Validation
            </button>
          </div>
        );

      case 'completed':
        return (
          <div className="text-center p-4">
            <h3 className="text-xl font-semibold text-green-600 mb-4">
              All Validations Completed Successfully!
            </h3>
            <button
              onClick={() => {
                cleanup();
                setCurrentStep('initial');
              }}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Start New Validation
            </button>
          </div>
        );

      default:
        return (
          <div className="text-center p-4">
            <h3 className="text-xl font-semibold text-blue-600 mb-4">
              {getActionDescription(currentStep)}
            </h3>
            <p className="text-gray-600">
              Hold the position until validated
            </p>
          </div>
        );
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <X className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}

          <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden mb-4">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
            <canvas
              ref={canvasRef}
              style={{ display: 'none' }}
            />
            
            {/* Camera controls overlay */}
            <div className="absolute inset-0">
              {renderWebSocketStatus()}
              
              {/* Initial countdown timer */}
              {countdown !== null && countdown > 0 && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-black bg-opacity-50 rounded-full w-24 h-24 flex items-center justify-center">
                    <span className="text-white text-5xl font-bold">
                      {countdown}
                    </span>
                  </div>
                </div>
              )}

              {/* Simple remaining time display */}
              {isCapturing && (
                <div className="absolute top-4 right-4 bg-black bg-opacity-50 px-3 py-1 rounded-full text-white">
                  <span>{remainingTime}s remaining</span>
                </div>
              )}

              {/* Camera close button */}
              {isCameraActive && !isCapturing && (
                <div className="absolute top-4 right-4">
                  <button
                    onClick={stopCamera}
                    className="p-2 bg-black bg-opacity-50 text-white rounded-full hover:bg-opacity-75 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition-all"
                    title="Close Camera"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              )}

              {/* Recording indicator */}
              {isCapturing && (
                <div className="absolute top-4 left-4">
                  <div className="flex items-center space-x-2 bg-black bg-opacity-50 px-3 py-1 rounded-full">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-white text-sm">Recording</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Validation Prompts */}
          {showPrompt && (
            <div className="mb-4 p-4 bg-green-50 border-l-4 border-green-500 text-green-700">
              <p className="text-sm font-medium">{promptMessage}</p>
              {showNextButton && (
                <button
                  onClick={handleNextStep}
                  className="mt-4 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                >
                  {currentStep === 'leftHand' ? 'Start Right Hand Validation' : 
                   currentStep === 'rightHand' ? 'Start Both Hands Validation' : 
                   'Continue to Next Page'}
                </button>
              )}
            </div>
          )}

          {status && !showPrompt && (
            <div className="mb-4 p-4 bg-blue-50 border-l-4 border-blue-500 text-blue-700">
              <p className="text-sm font-medium">{status}</p>
            </div>
          )}

          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default VideoTest; 