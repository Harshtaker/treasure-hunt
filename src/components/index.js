import { motion } from 'framer-motion';
import { useRouter } from 'next/router';
import { useState } from 'react';

export default function Login() {
  const [team, setTeam] = useState('');
  const router = useRouter();

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.5 }}
      className="min-h-screen flex items-center justify-center p-4"
    >
      <div className="max-w-md w-full parchment-card p-10 text-center">
        <motion.h1 
          initial={{ y: -20 }} animate={{ y: 0 }}
          className="text-4xl font-black mb-2 tracking-tighter"
        >
          THE GREAT EXPEDITION
        </motion.h1>
        <p className="indy-font text-sm mb-8 opacity-70">REC AMBEDKAR NAGAR • 2026</p>
        
        <form onSubmit={(e) => { e.preventDefault(); router.push('/dashboard'); }} className="space-y-8">
          <div className="relative">
            <input 
              type="text" required placeholder="TEAM DESIGNATION"
              className="w-full bg-transparent border-b-2 border-stone-800 p-3 outline-none text-center font-bold text-xl placeholder:opacity-30"
              onChange={(e) => setTeam(e.target.value)}
            />
          </div>
          
          <motion.button 
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="w-full bg-[#800000] text-parchment py-4 indy-font text-lg shadow-xl hover:bg-red-900 transition-colors"
          >
            BEGIN THE QUEST
          </motion.button>
        </form>
      </div>
    </motion.div>
  );
}