import { motion } from "framer-motion";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Zap, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col bg-gradient-to-br from-[#0a0a12] via-[#0d0d1a] to-[#0a0a12]"
    >
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/3 right-1/3 w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[100px]" />
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10">
        <div className="max-w-lg mx-auto relative px-4 text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 via-cyan-500 to-amber-500 flex items-center justify-center mx-auto mb-8 shadow-lg shadow-violet-500/25">
            <Zap className="w-10 h-10 text-white" />
          </div>
          
          <h1 className="text-8xl font-extrabold mb-4">
            <span className="bg-gradient-to-r from-violet-400 via-cyan-400 to-amber-400 bg-clip-text text-transparent">
              404
            </span>
          </h1>
          
          <p className="text-2xl font-bold text-white mb-2">Page Not Found</p>
          <p className="text-zinc-400 mb-8">
            The page you're looking for doesn't exist or has been moved.
          </p>
          
          <Link to="/">
            <Button className="bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 text-white font-bold px-8 py-3 h-auto shadow-lg shadow-violet-500/25">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to TRADSLY
            </Button>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
