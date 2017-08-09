const _ = require('lodash');

const nasaCenters = [
[44.87, -124.84166667],
[44.81, -123.205],
[44.73333333, -121.63333333],
[44.63833333, -120.12],
[44.53, -118.65833333],
[44.40666667, -117.24666667],
[44.27166667, -115.88],
[44.12333333, -114.555],
[43.965, -113.27],
[43.795, -112.02166667],
[43.61666667, -110.80833333],
[43.42666667, -109.62666667],
[43.22833333, -108.475],
[43.02166667, -107.35166667],
[42.80833333, -106.25666667],
[42.585, -105.18666667],
[42.355, -104.14],
[42.11833333, -103.11666667],
[41.875, -102.115],
[41.625, -101.135],
[41.36833333, -100.17333333],
[41.10666667, -99.23],
[40.83833333, -98.305],
[40.565, -97.395],
[40.285, -96.50166667],
[40, -95.62333333],
[39.71, -94.76],
[39.415, -93.90833333],
[39.11666667, -93.07],
[38.81166667, -92.24333333],
[38.50166667, -91.42666667],
[38.18833333, -90.62166667],
[37.87, -89.82666667],
[37.54666667, -89.04],
[37.22, -88.26166667],
[36.88833333, -87.49166667],
[36.55166667, -86.72833333],
[36.21166667, -85.97166667],
[35.86833333, -85.22166667],
[35.52, -84.47666667],
[35.16666667, -83.735],
[34.81, -82.99833333],
[34.44833333, -82.265],
[34.08333333, -81.535],
[33.715, -80.80666667],
[33.34166667, -80.07833333],
[32.96333333, -79.35333333]];


function addMidPoints(points){
    // create mid points to increase the resolution
    let midPoints = [];
    for(let i = 0; i < points.length; i++){
        // TODO insert as you are going through the array so there is no need for soritng later on
        let point = points[i];
        let nextPoint = points[i+1];
        if (!nextPoint) break; // this is the last pair
        function avg(a,b){
            return (a+b)/2;
        }
        let midPoint = [avg(point[0],nextPoint[0]),avg(point[1],nextPoint[1])];
        midPoints.push(midPoint);
    }
    let pathPoints = midPoints.concat(points);
    pathPoints.sort((a,b) => a[1]-b[1]); // sort by ascending longitude
    return pathPoints;
}
module.exports = () => {
    let pathPoints = addMidPoints(nasaCenters);
    pathPoints = addMidPoints(pathPoints);
    // pathPoints =  pathPoints.concat(addMidPoints(pathPoints.slice(0,30)));
    // pathPoints.sort((a,b) => a[1]-b[1]); // sort by ascending longitude
    return pathPoints;
};
