import { NextResponse } from "next/server";
import { evaluateAlphaForwardOutcomesV91 } from "@/lib/research/evaluate-alpha-forward-outcomes-v9-1";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request){
  try{
    const body=await request.json().catch(()=>({})) as Record<string,unknown>;
    const result=await evaluateAlphaForwardOutcomesV91({
      experimentId:typeof body.experimentId==="string"?body.experimentId:undefined,
    });
    return NextResponse.json({ok:true,result});
  }catch(error){
    return NextResponse.json({ok:false,message:error instanceof Error?error.message:"v9.1 forward evaluation failed."},{status:500});
  }
}
