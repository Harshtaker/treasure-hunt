import { motion } from 'framer-motion';

export default function AdventureButton({ children, onClick }) {
  return (
    <motion.button
      whileHover={{ scale: 1.05, boxShadow: "0 0 25px #ffd700" }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="bg-[#800000] border-2 border-gold text-parchment py-4 px-10 
                 rounded-sm uppercase tracking-widest font-bold shadow-2xl
                 transition-colors hover:bg-red-900"
    >
      {children}
    </motion.button>
  );
}