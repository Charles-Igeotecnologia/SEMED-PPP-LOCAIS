"use strict";

function downloadImplantationPdf({corners,center,width,length,angle,lots}) {
  if (!window.jspdf?.jsPDF) throw new Error("O gerador de PDF está indisponível. Recarregue o portal.");
  const project = latlng => L.CRS.EPSG3857.project(L.latLng(latlng));
  const footprint = corners.map(project);
  const difference = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
  const cross = (a,b) => a.x*b.y-a.y*b.x;
  const area = ring => {
    if (ring.length < 3) return 0;
    const origin = ring[0];
    return Math.abs(ring.reduce((sum,a,i) =>
      sum + cross(difference(a,origin),difference(ring[(i+1)%ring.length],origin)),0)) / 2;
  };
  // The rectangular footprint is convex. Clip each lot ring against its four
  // edges, then subtract holes and sum the components of each multipolygon.
  function clippedArea(ring) {
    const clipped = footprint.reduce((subject,start,i) => {
      const edge = difference(footprint[(i+1)%footprint.length],start);
      const output = [];
      for (let j=0; j<subject.length; j++) {
        const a = subject[j], b = subject[(j+1)%subject.length];
        const da = cross(edge,difference(a,start)), db = cross(edge,difference(b,start));
        if (da >= 0) output.push(a);
        if ((da >= 0) !== (db >= 0)) {
          const t = da/(da-db);
          output.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});
        }
      }
      return output;
    },ring);
    return area(clipped);
  }
  const overlaps = lots.map(lot => {
    const polygons = lot.geometry.type === "Polygon" ? [lot.geometry.coordinates] : lot.geometry.coordinates;
    const rings = polygons.map(poly => poly.map(ring => ring.map(([lng,lat]) => project([lat,lng]))));
    const overlap = rings.reduce((sum,[outer,...holes]) =>
      sum + clippedArea(outer) - holes.reduce((total,ring) => total + clippedArea(ring),0),0);
    return {lot,rings,overlap};
  }).filter(item => item.overlap > 1e-8).sort((a,b) => b.overlap-a.overlap);
  if (!overlaps.length) return false;

  const {lot,rings,overlap} = overlaps[0];
  const doc = new window.jspdf.jsPDF({unit:"mm",format:"a4",compress:true,putOnlyUsedFonts:true});
  const meters = new Intl.NumberFormat("pt-BR",{maximumFractionDigits:4});
  const margin = 14, pageWidth = 182;
  const ink = "#173343", muted = "#45616E", accent = "#006E78";
  const rose = "#AC0062", roseFill = "#F6A9D1", orange = "#99420D", orangeFill = "#FFE2C0";
  const text = (value,x,y,size=10,bold=false,color=ink) => {
    doc.setFont("helvetica",bold ? "bold" : "normal").setFontSize(size).setTextColor(color);
    doc.text(value,x,y);
  };
  doc.setProperties({title:"Simulação de implantação | SEMED / PPP",subject:lot.properties.title});
  doc.setFillColor(ink).rect(0,0,210,39,"F");
  text("SEMED MANAUS  /  PROJETO PPP",margin,12,9,true,"#D2E8ED");
  text("Simulação de implantação",margin,26,25,true,"#FFFFFF");
  text(lot.properties.title,margin,49,15,true);
  const code = lot.properties.fields.CGL;
  text(code ? "CGL " + code : "Polígono " + lot.properties.fields["ID na camada LOTES"] + " na camada LOTES",
    margin,55,9,false,muted);

  const metrics = [
    ["LARGURA",meters.format(width)+" m"],
    ["COMPRIMENTO",meters.format(length)+" m"],
    ["ÁREA SIMULADA",meters.format(width*length)+" m²"],
    ["ROTAÇÃO",angle+"°"]
  ];
  metrics.forEach(([label,value],i) => {
    const x = margin + i*46;
    doc.setFillColor("#EAF3F5").roundedRect(x,61,44,18,1,1,"F");
    text(label,x+3,67,7,true,accent);
    text(value,x+3,75,11,true);
  });

  function plot(y,height,extentPoints) {
    const xs = extentPoints.map(p => p.x), ys = extentPoints.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const factor = Math.min((pageWidth-28)/(maxX-minX),(height-20)/(maxY-minY));
    const xy = p => [
      margin + pageWidth/2 + (p.x-(maxX+minX)/2)*factor,
      y + height/2 - (p.y-(maxY+minY)/2)*factor
    ];
    const path = ring => {
      const points = ring.map(xy);
      const deltas = points.slice(1).map(([x,cy],i) => [x-points[i][0],cy-points[i][1]]);
      doc.lines(deltas,...points[0],[1,1],null,true);
    };
    doc.setFillColor("#F4F8F9").rect(margin,y,pageWidth,height,"F");
    doc.saveGraphicsState().rect(margin,y,pageWidth,height,null).clip().discardPath();
    for (const polygon of rings) {
      doc.setDrawColor(orange).setFillColor(orangeFill).setLineWidth(.45);
      polygon.forEach(path);
      doc.fillStrokeEvenOdd();
    }
    doc.setDrawColor(rose).setFillColor(roseFill).setLineWidth(.65);
    path(footprint);
    doc.fillStroke();
    const centerXY = xy(project(center));
    doc.setFillColor(rose).circle(...centerXY,.85,"F");
    doc.restoreGraphicsState();

    const [nx,ny] = [margin+pageWidth-8,y+11];
    text("N",nx-1,ny-4,8,true);
    doc.setFillColor(ink).triangle(nx,ny-2,nx-1.6,ny+4,nx+1.6,ny+4,"F");
    const paperPerMeter = factor / Math.cos(center.lat*Math.PI/180);
    const limit = 29/paperPerMeter;
    const unit = 10 ** Math.floor(Math.log10(limit));
    const bar = unit * (limit >= 5*unit ? 5 : limit >= 2*unit ? 2 : 1);
    const start = margin+4, barY = y+height-5;
    doc.setFillColor("#FFFFFF").rect(start-1,barY-8,bar*paperPerMeter+3,10,"F");
    doc.setDrawColor(ink).setLineWidth(.35).line(start,barY,start+bar*paperPerMeter,barY);
    text(meters.format(bar)+" m",start,barY-2,7,true);
    doc.setDrawColor("#C9DADF").setLineWidth(.25).rect(margin,y,pageWidth,height,"S");
  }

  text("01  VISTA DO LOTE",margin,88,9,true,accent);
  plot(91,83,[...rings.flat(2),...footprint]);
  text("02  DETALHE DA IMPLANTAÇÃO",margin,184,9,true,accent);
  plot(187,67,footprint);
  doc.setDrawColor(orange).setFillColor(orangeFill).rect(margin,260,4,3,"FD");
  text("Limite do lote",margin+6,262.6,8);
  doc.setDrawColor(rose).setFillColor(roseFill).rect(margin+43,260,4,3,"FD");
  text("Implantação simulada",margin+49,262.6,8);
  const relation = overlap / area(footprint) > .999999 ? "Contida no lote" : "Sobreposição parcial com o lote";
  text(relation,margin+105,262.6,8,true);
  text("Centro (WGS 84)  "+center.lat.toFixed(7)+", "+center.lng.toFixed(7)+
    "    |    Rotação no sentido horário a partir do norte.",margin,272,8,false,muted);
  text("Fonte do lote: NOVA BASE.gdb. Mapa vetorial com escala gráfica aproximada.",margin,278,8,false,muted);
  const note = overlaps.length > 1 ? "Lote de referência escolhido pela maior sobreposição." : "Simulação geométrica para estudo de implantação.";
  text(note,margin,284,8,false,muted);
  doc.save("simulacao-implantacao-"+lot.id.split(":").at(-1)+".pdf");
  return true;
}
