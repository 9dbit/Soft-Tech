import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Portal from "@/components/portal";
import { games } from "@/data/games";
type RouteParams = { params: Promise<{ route: string[] }> };
const sections = new Set(["games", "company", "technology", "partners", "contact"]);
function getValid(route:string[]){
  const path=route.join("/");
  return sections.has(path) || (route.length===2 && route[0]==="games" && games.some(g=>g.id===route[1]));
}
export async function generateMetadata({params}:RouteParams):Promise<Metadata>{
  const {route}=await params;
  if(!getValid(route))return {title:"Not Found"};
  const game=route[0]==="games"&&route.length===2?games.find(g=>g.id===route[1]):undefined;
  if(game)return {title:game.name,description:game.description,openGraph:{title:game.name,description:game.description,images:[game.cover]}};
  const names:Record<string,string>={games:"Our Games",company:"Company",technology:"Technology",partners:"Partnerships",contact:"Contact"};
  return {title:names[route[0]]||"Soft Tech"};
}
export default async function RoutePage({params}:RouteParams){
  const {route}=await params;
  if(!getValid(route))notFound();
  return <Portal/>;
}
