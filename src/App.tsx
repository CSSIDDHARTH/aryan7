import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Trophy, Medal, Crown, Play, User, ChevronRight, Star, LogIn, LogOut, Loader2, AlertCircle } from 'lucide-react';
import { playSound } from './sounds';
import { db } from './firebase';

// Using global firebase from CDN for types if needed, but compat SDK is used via db
declare global {
  interface Window {
    firebase: any;
  }
}

const firebase = (window as any).firebase;

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    isAnonymous: boolean;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: 'anonymous',
      isAnonymous: true
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const INITIAL_SIMPLE_ISSUES = [
  "More CCTVs and extended night patrol",
  "Clean toilets and more dustbins",
  "Clean drinking water",
  "Faster document and application approvals",
  "Better campus Wi-Fi",
  "More seating areas",
  "Improved library hours",
  "Cheaper printing facilities"
];

const INITIAL_BIG_ISSUES = [
  "Medical + stationery shop in every hostel, more ambulances",
  "Mess attendance digitalization + centralized student app",
  "Open-air theatre + all-night canteen + hostel courts + extended ground hours",
  "New sports equipment & gym upgrade",
  "Annual tech & cultural fest expansion",
  "Dedicated student grievance cell"
];

const LEADERBOARD_KEY = 'cricketLeaderboard';
const ARYAN_NAME = "Aryan V Nair";

type GameState = 'start' | 'playing' | 'round_end' | 'game_over';
type BallState = 'idle' | 'bowling' | 'hit' | 'defended';

type ScoreEntry = {
  name: string;
  score: number;
  timestamp: number;
  isCurrent?: boolean;
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>('start');
  const [round, setRound] = useState(1);
  const [ballsPlayed, setBallsPlayed] = useState(0);
  
  const [simpleIssues, setSimpleIssues] = useState([...INITIAL_SIMPLE_ISSUES]);
  const [bigIssues, setBigIssues] = useState([...INITIAL_BIG_ISSUES]);
  const [solvedIssues, setSolvedIssues] = useState<{ text: string; type: 'simple' | 'big'; runs: number }[]>([]);
  
  const [ballState, setBallState] = useState<BallState>('idle');
  const [currentIssue, setCurrentIssue] = useState<{ text: string; type: 'simple' | 'big'; runs: number } | null>(null);
  const [showIssuePopup, setShowIssuePopup] = useState(false);

  const [playerName, setPlayerName] = useState('');
  const [isNameSubmitted, setIsNameSubmitted] = useState(false);
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  const [personalBest, setPersonalBest] = useState(0);
  const [showPersonalBestBanner, setShowPersonalBestBanner] = useState(false);
  
  const [showFullLeaderboard, setShowFullLeaderboard] = useState(false);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(true);
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rankAfterSubmit, setRankAfterSubmit] = useState<number | null>(null);
  const [pointsToNextRank, setPointsToNextRank] = useState<number | null>(null);
  const [nextRankPlayerName, setNextRankPlayerName] = useState<string | null>(null);

  const ballTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!db) return;

    const q = db.collection('leaderboard').orderBy('score', 'desc').limit(100);
    const unsubscribe = q.onSnapshot((snapshot: any) => {
      const entries = snapshot.docs.map((doc: any) => ({
        ...doc.data(),
        isCurrent: false // We'll handle highlighting by name match later
      })) as ScoreEntry[];
      
      setLeaderboard(entries);
      setIsLoadingLeaderboard(false);
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, 'leaderboard');
    });

    return () => unsubscribe();
  }, []);

  const calculateScore = () => {
    const total = solvedIssues.reduce((acc, issue) => acc + issue.runs, 0);
    return Math.min(total, 50); // Hard cap at 50
  };

  const currentScore = calculateScore();

  const getAryanScore = (entries: ScoreEntry[]) => {
    const maxPlayerScore = entries.length > 0 ? Math.max(...entries.map(e => e.score)) : 0;
    return Math.max(maxPlayerScore + 1, 1); // Aryan is always 1 more than max
  };

  const startGame = () => {
    setGameState('playing');
    setRound(1);
    setBallsPlayed(0);
    setSolvedIssues([]);
    setSimpleIssues([...INITIAL_SIMPLE_ISSUES]);
    setBigIssues([...INITIAL_BIG_ISSUES]);
    setIsNameSubmitted(false);
    setShowPersonalBestBanner(false);
    nextBall([...INITIAL_SIMPLE_ISSUES], [...INITIAL_BIG_ISSUES]);
  };

  const nextRound = () => {
    setGameState('playing');
    setRound(r => r + 1);
    setBallsPlayed(0);
    nextBall(simpleIssues, bigIssues);
  };

  const nextBall = (currentSimple: string[], currentBig: string[]) => {
    setBallState('idle');
    setShowIssuePopup(false);
    setCurrentIssue(null);
    
    if (currentSimple.length === 0 && currentBig.length === 0) {
      setGameState('game_over');
      return;
    }

    // Start bowling after a short delay
    setTimeout(() => {
      setBallState('bowling');
      
      // Auto-defend timeout (if not swiped within 1.5 seconds)
      ballTimeoutRef.current = setTimeout(() => {
        handleDefend(currentSimple, currentBig);
      }, 1500);
    }, 1000);
  };

  const handleHit = () => {
    if (ballState !== 'bowling') return;
    
    if (ballTimeoutRef.current) clearTimeout(ballTimeoutRef.current);
    
    setBallState('hit');
    playSound('hit');
    playSound('cheer');
    
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#FFD700', '#000080', '#FFFFFF', '#FF0000', '#00FF00']
    });

    // Pick a big issue if available, else simple
    let type: 'simple' | 'big' = bigIssues.length > 0 ? 'big' : 'simple';
    let text = type === 'big' 
      ? bigIssues[Math.floor(Math.random() * bigIssues.length)]
      : simpleIssues[Math.floor(Math.random() * simpleIssues.length)];

    // Hit gives 2 or 4 runs
    const runs = Math.random() > 0.5 ? 4 : 2;

    setCurrentIssue({ text, type, runs });
    resolveIssue(text, type, runs);
  };

  const handleDefend = (currentSimple: string[], currentBig: string[]) => {
    if (ballState !== 'bowling') return;
    
    setBallState('defended');
    playSound('defend');
    playSound('cheer');
    
    // Pick a simple issue if available, else big
    let type: 'simple' | 'big' = currentSimple.length > 0 ? 'simple' : 'big';
    let text = type === 'simple' 
      ? currentSimple[Math.floor(Math.random() * currentSimple.length)]
      : currentBig[Math.floor(Math.random() * currentBig.length)];

    // Defend gives 1 or 2 runs
    const runs = Math.floor(Math.random() * 2) + 1;

    setCurrentIssue({ text, type, runs });
    resolveIssue(text, type, runs, currentSimple, currentBig);
  };

  const handleGameOver = () => {
    setGameState('game_over');
  };

  const submitScore = async (name: string) => {
    if (!name.trim()) return;
    if (!db) {
      console.error("Firestore not initialized");
      return;
    }

    setIsSubmittingScore(true);
    const finalScore = calculateScore();
    
    try {
      setSubmitError(null);
      console.log("Submitting score for:", name.trim(), "Score:", finalScore);
      
      // Check for personal best by name - simplified to avoid composite index requirement
      const q = db.collection('leaderboard').where('name', '==', name.trim());
      const snapshot = await q.get();
      console.log("Existing entries found:", snapshot.size);
      
      let existingBest = 0;
      snapshot.forEach((doc: any) => {
        const data = doc.data();
        if (data.score > existingBest) {
          existingBest = data.score;
        }
      });
      
      let shouldUpdate = finalScore > existingBest;

      if (shouldUpdate) {
        console.log("Updating personal best to:", finalScore);
        await db.collection('leaderboard').add({
          name: name.trim(),
          score: finalScore,
          timestamp: Date.now()
        });
        console.log("Score added successfully");
        
        if (finalScore > personalBest) {
          setPersonalBest(finalScore);
          setShowPersonalBestBanner(true);
          confetti({
            particleCount: 150,
            spread: 100,
            origin: { y: 0.6 },
            colors: ['#FFD700', '#FFFFFF']
          });
        }
      }

      // Calculate rank and points to next rank
      // Limit to top 100 to avoid hanging on large collections
      const fullSnapshot = await db.collection('leaderboard').orderBy('score', 'desc').limit(100).get();
      const allEntries = fullSnapshot.docs.map((doc: any) => doc.data());
      
      // Find player's best rank
      const playerBestScore = Math.max(finalScore, existingBest);
      const rankIndex = allEntries.findIndex((e: any) => e.score <= playerBestScore);
      
      // If not in top 100, rank is 100+
      const rank = rankIndex === -1 ? 102 : rankIndex + 2; // +2 for 1-based and Aryan at #1
      
      setRankAfterSubmit(rank);
      
      // Points to next rank
      if (rank > 2 && rank <= 101) { 
        const nextPlayer = allEntries[rankIndex - 1]; // rankIndex is current player, rankIndex-1 is player above
        if (nextPlayer) {
          setPointsToNextRank(nextPlayer.score - playerBestScore);
          setNextRankPlayerName(nextPlayer.name);
        }
      } else if (rank === 2) {
        const aryanScore = getAryanScore(allEntries as any);
        setPointsToNextRank(aryanScore - playerBestScore);
        setNextRankPlayerName(ARYAN_NAME);
      }

      setIsNameSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to save score. Please try again.");
      console.error("Submit score error:", error);
    } finally {
      setIsSubmittingScore(false);
    }
  };

  const resolveIssue = (text: string, type: 'simple' | 'big', runs: number, currentSimple = simpleIssues, currentBig = bigIssues) => {
    setShowIssuePopup(true);
    
    // Remove from pending, add to solved
    let newSimple = [...currentSimple];
    let newBig = [...currentBig];
    
    if (type === 'simple') {
      newSimple = newSimple.filter(i => i !== text);
    } else {
      newBig = newBig.filter(i => i !== text);
    }
    
    setSimpleIssues(newSimple);
    setBigIssues(newBig);
    setSolvedIssues(prev => [...prev, { text, type, runs }]);
    
    const newBallsPlayed = ballsPlayed + 1;
    setBallsPlayed(newBallsPlayed);

    setTimeout(() => {
      // Early out simulation: if first 3 balls and score is low, maybe end?
      // Actually, let's just stick to the 7 balls per round or all issues solved.
      if (newSimple.length === 0 && newBig.length === 0) {
        handleGameOver();
      } else if (newBallsPlayed >= 7) {
        setGameState('round_end');
      } else {
        nextBall(newSimple, newBig);
      }
    }, 2000);
  };

  const touchStartRef = useRef<{x: number, y: number} | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    touchStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!touchStartRef.current || ballState !== 'bowling') return;
    
    const dx = e.clientX - touchStartRef.current.x;
    const dy = e.clientY - touchStartRef.current.y;
    
    // If swipe distance is greater than 30px
    if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
      handleHit();
    }
    touchStartRef.current = null;
  };

  return (
    <div className="min-h-screen bg-blue-900 text-white font-sans overflow-hidden relative select-none touch-none">
      {/* Background Elements */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute top-10 left-10 text-6xl font-bold text-yellow-400 transform -rotate-12">7</div>
        <div className="absolute bottom-20 right-10 text-8xl font-bold text-yellow-400 transform rotate-12">7</div>
        <div className="absolute top-1/2 left-1/4 text-4xl font-bold text-yellow-400 transform rotate-45">7</div>
      </div>

      <AnimatePresence mode="wait">
        {gameState === 'start' && (
          <motion.div 
            key="start"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-blue-900"
          >
            {/* Beat the Legend Banner */}
            <motion.div 
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="absolute top-8 left-0 right-0 flex flex-col items-center gap-2 px-4"
            >
              <div className="bg-yellow-400 text-blue-900 px-4 py-2 rounded-full font-bold text-sm shadow-lg flex items-center gap-2 border-2 border-blue-900">
                <Crown size={16} className="text-blue-900" />
                <span>Can you beat the Legend? {ARYAN_NAME} leads with {getAryanScore(leaderboard)} runs!</span>
              </div>
            </motion.div>

            <motion.h1 
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ repeat: Infinity, repeatType: "reverse", duration: 1 }}
              className="text-5xl font-black text-yellow-400 mb-2 drop-shadow-lg uppercase tracking-wider"
              style={{ fontFamily: "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', sans-serif" }}
            >
              Aryan
            </motion.h1>
            <h2 className="text-3xl font-bold text-white mb-8 bg-red-600 px-4 py-2 rounded-lg transform -rotate-2">
              BALLOT NO. 7 ARYAN V NAIR
            </h2>
            <p className="text-xl mb-8 max-w-sm">
              Swipe to hit big issues!<br/>
              Auto-defend simple issues!<br/>
              Aryan never loses!
            </p>
            <button 
              onClick={startGame}
              className="bg-yellow-400 text-blue-900 text-2xl font-bold py-4 px-12 rounded-full shadow-[0_6px_0_#b8860b] active:shadow-[0_0px_0_#b8860b] active:translate-y-[6px] transition-all flex items-center gap-2"
            >
              <Play fill="currentColor" size={24} />
              PLAY NOW
            </button>
          </motion.div>
        )}

        {gameState === 'playing' && (
          <motion.div 
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* Top HUD */}
            <div className="flex justify-between items-center p-4 bg-blue-950 shadow-md z-20">
              <div className="text-yellow-400 font-bold text-xl">ROUND {round}</div>
              <div className="flex gap-1">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className={`w-4 h-4 rounded-full ${i < ballsPlayed ? 'bg-green-500' : 'bg-gray-600'}`} />
                ))}
              </div>
              <div className="text-white font-bold bg-red-600 px-2 py-1 rounded text-sm">BALLOT 7 ARYAN V NAIR</div>
            </div>

            {/* Game Area */}
            <div className="flex-1 relative overflow-hidden flex flex-col items-center justify-between py-10">
              
              {/* Bowler */}
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center border-4 border-gray-900 shadow-lg">
                  <span className="text-gray-400 font-bold text-xs text-center">OLD<br/>PROBLEMS</span>
                </div>
              </div>

              {/* Pitch */}
              <div className="absolute top-20 bottom-32 w-32 bg-green-600/30 transform perspective-1000 rotateX-60" style={{ transform: 'perspective(500px) rotateX(45deg)' }}></div>

              {/* The Ball */}
              <AnimatePresence>
                {ballState !== 'idle' && (
                  <motion.div
                    key="ball"
                    initial={{ y: -300, scale: 0.5, opacity: 0 }}
                    animate={
                      ballState === 'bowling' ? { y: 200, scale: 1.5, opacity: 1 } :
                      ballState === 'hit' ? { y: -500, x: (Math.random() - 0.5) * 400, scale: 0.5, opacity: 0 } :
                      ballState === 'defended' ? { y: 220, scale: 1.5, opacity: 0 } : {}
                    }
                    transition={{ 
                      duration: ballState === 'bowling' ? 2 : 0.5,
                      ease: ballState === 'bowling' ? "linear" : "easeOut"
                    }}
                    className="absolute top-32 w-12 h-12 bg-red-500 rounded-full border-4 border-white shadow-xl flex items-center justify-center z-20"
                  >
                    <span className="text-[8px] font-bold text-white leading-tight text-center px-1">ISSUE</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Issue Popup */}
              <AnimatePresence>
                {showIssuePopup && currentIssue && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0, y: 50 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className="absolute top-1/2 left-4 right-4 bg-white text-blue-900 p-4 rounded-xl shadow-2xl z-30 text-center border-4 border-yellow-400"
                  >
                    <div className="text-green-600 font-black text-2xl mb-2 uppercase">
                      {ballState === 'hit' ? 'SMASHED!' : 'DEFENDED!'}
                    </div>
                    <div className="font-bold text-lg">{currentIssue.text}</div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Batsman (Aryan) */}
              <div className="relative z-10 flex flex-col items-center mt-auto">
                <motion.div 
                  animate={
                    ballState === 'hit' ? { rotate: -60, x: -20 } :
                    ballState === 'defended' ? { y: [0, -20, 0, -10, 0] } : {}
                  }
                  transition={{ duration: 0.5 }}
                  className="w-24 h-32 bg-yellow-400 rounded-t-full border-4 border-blue-900 shadow-lg flex flex-col items-center justify-center relative"
                >
                  <div className="text-blue-900 font-black text-4xl">7</div>
                  <div className="text-blue-900 font-bold text-xs mt-1">ARYAN</div>
                  
                  {/* Bat */}
                  <motion.div 
                    animate={
                      ballState === 'hit' ? { rotate: -120, x: -40, y: -20 } :
                      ballState === 'defended' ? { rotate: -20, x: -10, y: -10 } :
                      { rotate: 20, x: 20, y: 10 }
                    }
                    className="absolute bottom-0 right-0 w-4 h-24 bg-orange-300 border-2 border-orange-800 rounded-b-lg origin-bottom"
                  />
                </motion.div>
              </div>

              {/* Swipe Instruction */}
              {ballState === 'bowling' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.7 }}
                  className="absolute bottom-40 text-white/50 font-bold text-xl pointer-events-none flex flex-col items-center"
                >
                  <div className="animate-bounce mb-2">↑</div>
                  SWIPE TO HIT
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {gameState === 'round_end' && (
          <motion.div 
            key="round_end"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-40 bg-blue-900/95"
          >
            <h2 className="text-5xl font-black text-yellow-400 mb-4">ROUND {round} CLEARED!</h2>
            <p className="text-xl text-white mb-8">Aryan is unstoppable!</p>
            <button 
              onClick={nextRound}
              className="bg-green-500 text-white text-2xl font-bold py-4 px-12 rounded-full shadow-[0_6px_0_#006400] active:shadow-[0_0px_0_#006400] active:translate-y-[6px] transition-all"
            >
              PLAY MORE
            </button>
          </motion.div>
        )}

        {gameState === 'game_over' && (
          <motion.div 
            key="game_over"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center p-6 text-center z-50 bg-blue-900 overflow-y-auto"
          >
            {!isNameSubmitted ? (
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="w-full max-w-md mt-12 bg-white/10 p-8 rounded-2xl border-2 border-yellow-400 shadow-2xl"
              >
                <Trophy size={64} className="text-yellow-400 mx-auto mb-4" />
                <h2 className="text-3xl font-black text-white mb-2 uppercase">Match Over!</h2>
                <p className="text-yellow-400 font-bold text-xl mb-6">Your Score: {currentScore} Runs</p>
                
                <div className="text-left mb-6">
                  <label className="block text-sm font-bold text-gray-300 mb-2 flex items-center gap-2">
                    <User size={16} /> ENTER YOUR NAME TO SAVE SCORE
                  </label>
                  <input 
                    type="text" 
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Enter name..."
                    className="w-full bg-blue-950 border-2 border-blue-800 rounded-lg px-4 py-3 text-white focus:border-yellow-400 outline-none transition-all"
                    maxLength={20}
                  />
                </div>

                <button 
                  onClick={() => submitScore(playerName)}
                  disabled={isSubmittingScore}
                  className="w-full bg-yellow-400 text-blue-900 font-black py-4 rounded-lg shadow-[0_4px_0_#b8860b] active:shadow-none active:translate-y-[4px] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmittingScore ? <Loader2 className="animate-spin" /> : 'SAVE & VIEW RANK'} <ChevronRight size={20} />
                </button>

                {submitError && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-3 bg-red-500/20 border border-red-500 rounded-lg flex items-center gap-2 text-red-400 text-sm text-left"
                  >
                    <AlertCircle size={16} className="shrink-0" />
                    <span>{submitError}</span>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <div className="w-full max-w-md mt-4 pb-12">
                {showPersonalBestBanner && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="bg-green-500 text-white font-black py-2 px-4 rounded-full mb-4 inline-flex items-center gap-2 shadow-lg"
                  >
                    <Star size={16} fill="white" /> NEW PERSONAL BEST!
                  </motion.div>
                )}

                {rankAfterSubmit && (
                  <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="bg-white/10 p-6 rounded-2xl border-2 border-yellow-400 mb-8"
                  >
                    <div className="text-gray-300 font-bold text-sm uppercase mb-1">Your Official Rank</div>
                    <div className="text-5xl font-black text-white mb-2">#{rankAfterSubmit}</div>
                    
                    {pointsToNextRank !== null && nextRankPlayerName && (
                      <div className="text-yellow-400 font-bold text-sm">
                        You are {pointsToNextRank} runs behind rank {rankAfterSubmit - 1} ({nextRankPlayerName})!
                      </div>
                    )}
                    
                    <div className="mt-4 text-white font-bold text-xs bg-red-600 inline-block px-3 py-1 rounded-full">
                      Reach TOP 3 to win a reward from Aryan V Nair!
                    </div>
                  </motion.div>
                )}

                {/* Reward Banner */}
                <motion.div
                  animate={{ scale: [1, 1.02, 1], borderColor: ['#22c55e', '#fbbf24', '#22c55e'] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="bg-green-600 text-white p-4 rounded-xl border-4 mb-8 shadow-xl text-left relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-2 opacity-20">
                    <Trophy size={48} />
                  </div>
                  <h3 className="font-black text-lg mb-1 leading-tight">TOP 3 PLAYERS WIN A SPECIAL REWARD FROM ARYAN V NAIR!</h3>
                  <p className="text-xs font-bold opacity-90 mb-3">Play your best — top 3 on the leaderboard at the end of the campaign will be personally rewarded.</p>
                  
                  <div className="flex gap-2">
                    <div className="bg-yellow-400 text-blue-900 px-2 py-1 rounded text-[10px] font-black flex items-center gap-1">
                      <Trophy size={10} /> #1: GOLD REWARD
                    </div>
                    <div className="bg-gray-200 text-blue-900 px-2 py-1 rounded text-[10px] font-black flex items-center gap-1">
                      <Trophy size={10} /> #2: SILVER REWARD
                    </div>
                    <div className="bg-orange-400 text-blue-900 px-2 py-1 rounded text-[10px] font-black flex items-center gap-1">
                      <Trophy size={10} /> #3: BRONZE REWARD
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-2 text-white/80 font-black text-xl uppercase tracking-tighter"
                >
                  Ballot no 7 aryan v nair
                </motion.div>

                <div className="flex items-center justify-center gap-3 mb-6">
                  <h2 className="text-4xl font-black text-yellow-400 flex items-center gap-3">
                    <Crown className="text-yellow-400" /> HALL OF FAME
                  </h2>
                  <div className="flex items-center gap-1 bg-green-500/20 px-2 py-1 rounded-full border border-green-500/50">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-black text-green-400 uppercase">Live</span>
                  </div>
                </div>

                {/* Leaderboard */}
                <div className="bg-green-900/40 rounded-2xl border-2 border-green-500/30 overflow-hidden shadow-2xl mb-8">
                  <div className="bg-green-800/60 p-3 grid grid-cols-12 gap-2 text-xs font-black text-green-400 uppercase tracking-widest border-b border-green-500/30">
                    <div className="col-span-2">RANK</div>
                    <div className="col-span-7 text-left">PLAYER</div>
                    <div className="col-span-3 text-right">SCORE</div>
                  </div>

                  <div className="divide-y divide-green-500/10">
                    {/* Aryan V Nair - Fixed Legend Spot */}
                    <motion.div 
                      className="p-4 grid grid-cols-12 gap-2 items-center bg-yellow-400/10 relative overflow-hidden border-l-4 border-[#EF9F27]"
                    >
                      <div className="col-span-2 font-black text-yellow-400 text-lg">#1</div>
                      <div className="col-span-7 text-left flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center shrink-0">
                          <Crown size={16} className="text-blue-900" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-black text-white text-sm">{ARYAN_NAME}</span>
                          <div className="flex gap-1">
                            <span className="text-[10px] font-black text-yellow-400 uppercase bg-yellow-400/20 px-1 rounded">Legend</span>
                            <span className="text-[10px] font-black text-yellow-400 uppercase bg-yellow-400/20 px-1 rounded">Champion</span>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-3 text-right font-black text-yellow-400 text-xl">
                        {getAryanScore(leaderboard)}
                      </div>
                    </motion.div>

                    {isLoadingLeaderboard ? (
                      /* Skeleton Loading */
                      [...Array(10)].map((_, i) => (
                        <div key={i} className="p-4 grid grid-cols-12 gap-2 items-center animate-pulse">
                          <div className="col-span-2 h-4 bg-gray-700 rounded w-1/2" />
                          <div className="col-span-7 h-4 bg-gray-700 rounded w-3/4" />
                          <div className="col-span-3 h-4 bg-gray-700 rounded w-1/2 ml-auto" />
                        </div>
                      ))
                    ) : (
                      /* Real Data */
                      <AnimatePresence>
                        {(showFullLeaderboard ? leaderboard : leaderboard.slice(0, 10)).map((entry, idx) => {
                          const rank = idx + 2;
                          const isCurrent = entry.name === playerName;
                          return (
                            <motion.div 
                              key={idx} 
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={`p-4 grid grid-cols-12 gap-2 items-center transition-all ${isCurrent ? 'bg-yellow-400/20 ring-2 ring-yellow-400/50 z-10' : 'bg-transparent'}`}
                            >
                              <div className="col-span-2 font-bold text-gray-400">
                                {rank === 2 ? <Medal className="text-gray-300" size={20} /> : 
                                 rank === 3 ? <Medal className="text-orange-400" size={20} /> : 
                                 `#${rank}`}
                              </div>
                              <div className="col-span-7 text-left font-bold text-white truncate">
                                {entry.name} {isCurrent && <span className="text-[10px] bg-yellow-400 text-blue-900 px-1 rounded ml-1">YOU</span>}
                              </div>
                              <div className={`col-span-3 text-right font-black ${isCurrent ? 'text-yellow-400' : 'text-white'}`}>
                                {entry.score}
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    )}
                  </div>
                  
                  {!isLoadingLeaderboard && leaderboard.length > 10 && (
                    <button 
                      onClick={() => setShowFullLeaderboard(!showFullLeaderboard)}
                      className="w-full p-3 bg-green-800/40 text-green-400 font-bold text-xs uppercase tracking-widest hover:bg-green-800/60 transition-all"
                    >
                      {showFullLeaderboard ? 'Show Top 10 Only' : 'Show Full Scoreboard'}
                    </button>
                  )}
                </div>

                <button 
                  onClick={startGame}
                  className="bg-yellow-400 text-blue-900 text-2xl font-black py-4 px-12 rounded-full shadow-[0_6px_0_#b8860b] active:shadow-none active:translate-y-[6px] transition-all flex items-center gap-2 mx-auto"
                >
                  <Play fill="currentColor" size={24} /> PLAY AGAIN
                </button>

                <div className="mt-12 w-full bg-white/5 rounded-xl p-4 text-left">
                  <h3 className="text-lg font-bold text-yellow-400 mb-4 border-b border-yellow-400/30 pb-2">Your Campaign Impact:</h3>
                  <ul className="space-y-3">
                    {solvedIssues.map((issue, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm font-black text-white leading-tight">
                        <span className="text-green-400 shrink-0 mt-0.5">✓</span>
                        <span>{issue.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
