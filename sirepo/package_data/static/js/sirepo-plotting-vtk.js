'use strict';

var srlog = SIREPO.srlog;
var srdbg = SIREPO.srdbg;
SIREPO.DEFAULT_COLOR_MAP = 'viridis';

SIREPO.app.factory('vtkPlotting', function(appState, errorService, geometry, plotting, panelState, requestSender, utilities, $location, $rootScope, $timeout, $window) {

    var self = {};
    var stlReaders = {};

    self.addSTLReader = function(file, reader) {
        stlReaders[file] = reader;
    };

    self.adjustContainerSize = function(container, rect, ctrAspectRatio, thresholdPct) {
        var fsAspectRatio = window.screen.availWidth / window.screen.availHeight;

        container.height(container.width() / (utilities.isFullscreen() ? fsAspectRatio : ctrAspectRatio));

        var w = container.width();
        var h = container.height();
        var wThresh = Math.max(thresholdPct * w, 1);
        var hThresh = Math.max(thresholdPct * h, 1);
        var wdiff = Math.abs(w - rect.width);
        var hdiff = Math.abs(h - rect.height);
        if (hdiff > hThresh || wdiff > wThresh) {
            return true;
        }
        return false;
    };

    self.coordMapper = function(transform) {

        // "Bundles" a source, mapper, and actor together
        function actorBundle(source) {
            var m = vtk.Rendering.Core.vtkMapper.newInstance();
            if (source) {
                m.setInputConnection(source.getOutputPort());
            }
            var a = vtk.Rendering.Core.vtkActor.newInstance({
                mapper: m
            });

            return {
                actor: a,
                source: source,
                mapper: m,
                setActor: function (actor) {
                    actor.setMapper(this.m);
                    this.actor = actor;
                },
                setMapper: function (mapper) {
                    this.mapper = mapper;
                    this.actor.setMapper(mapper);
                },
                setSource: function (source) {
                    this.mapper.setInputConnection(source.getOutputPort());
                    this.source = source;
                }
            };
        }

        return {

            xform: transform || geometry.transform(),

            buildActorBundle: function(source) {
                return actorBundle(source);
            },

            buildBox: function(labSize, labCenter) {
                var vsize = labSize ? this.xform.doTransform(labSize) :  [1, 1, 1];
                var cs = vtk.Filters.Sources.vtkCubeSource.newInstance({
                    xLength: vsize[0],
                    yLength: vsize[1],
                    zLength: vsize[2],
                    center: labCenter ? this.xform.doTransform(labCenter) :  [0, 0, 0]
                });
                var ab = actorBundle(cs);

                ab.setCenter = function (arr) {
                    ab.source.setCenter(arr);
                };
                ab.setLength = function (arr) {
                    ab.source.setXLength(arr[0]);
                    ab.source.setYLength(arr[1]);
                    ab.source.setZLength(arr[2]);
                };

                return ab;
            },

            // arbitrary vtk source, transformed
            buildFromSource: function(src) {
                // add transform
                return actorBundle(src);
            },

            buildLine: function(labP1, labP2, colorArray) {
                var vp1 = this.xform.doTransform(labP1);
                var vp2 = this.xform.doTransform(labP2);
                var ls = vtk.Filters.Sources.vtkLineSource.newInstance({
                    point1: [vp1[0], vp1[1], vp1[2]],
                    point2: [vp2[0], vp2[1], vp2[2]],
                    resolution: 2
                });

                var ab = actorBundle(ls);
                ab.actor.getProperty().setColor(colorArray[0], colorArray[1], colorArray[2]);
                return ab;
            },

            buildPlane: function(labOrigin, labP1, labP2) {
                var src = vtk.Filters.Sources.vtkPlaneSource.newInstance();
                var b = actorBundle(src);
                if (labOrigin && labP1 && labP2) {
                    this.setPlane(b, labOrigin, labP1, labP2);
                }
                return b;
            },

            buildSphere: function(lcenter, radius, colorArray) {
                var ps = vtk.Filters.Sources.vtkSphereSource.newInstance({
                    center: lcenter ? this.xform.doTransform(lcenter) : [0, 0, 0],
                    radius: radius || 1,
                    thetaResolution: 16,
                    phiResolution: 16
                });

                var ab = actorBundle(ps);
                //ab.actor.getProperty().setColor(...(colorArray || [1, 1, 1]));
                var ca = colorArray || [1, 1, 1];
                ab.actor.getProperty().setColor(ca[0], ca[1], ca[2]);
                ab.actor.getProperty().setLighting(false);
                return ab;
            },

            buildSTL: function(file, callback) {
                var cm = this;
                var r = self.getSTLReader(file);

                if (r) {
                    setSTL(r);
                    return;
                }
                self.loadSTLFile(file).then(function (r) {
                    r.loadData()
                        .then(function (res) {
                            self.addSTLReader(file, r);
                            setSTL(r);
                        }, function (reason) {
                            throw new Error(file + ': Error loading data from .stl file: ' + reason);
                        }
                    ).catch(function (e) {
                        errorService.alertText(e);
                    });
                });

                function setSTL(r) {
                    var b = actorBundle(r);
                    var a = b.actor;
                    var userMatrix = [];
                    cm.xform.matrix.forEach(function (row) {
                        userMatrix = userMatrix.concat(row);
                        userMatrix.push(0);
                    });
                    userMatrix = userMatrix.concat([0, 0, 0, 1]);
                    a.setUserMatrix(userMatrix);
                    callback(b);
                }

            },

            setPlane: function(planeBundle, labOrigin, labP1, labP2) {
                var vo = labOrigin ? this.xform.doTransform(labOrigin) : [0, 0, 0];
                var vp1 = labP1 ? this.xform.doTransform(labP1) : [0, 0, 1];
                var vp2 = labP2 ? this.xform.doTransform(labP2) : [1, 0, 0];
                planeBundle.source.setOrigin(vo[0], vo[1], vo[2]);
                planeBundle.source.setPoint1(vp1[0], vp1[1], vp1[2]);
                planeBundle.source.setPoint2(vp2[0], vp2[1], vp2[2]);
            },

            userMatrix: function () {
                // Array.flat() doesn't exist in MS browsers
                // var m = transform.matrix.flat();
                var matrix = transform.matrix;
                var m = [];
                for (var i = 0; i < matrix.length; i++) {
                    for (var j = 0; j < matrix[i].length; j++) {
                        m.push(matrix[i][j]);
                    }
                }
                m.splice(3, 0, 0);
                m.splice(7, 0, 0);
                m.push(0);
                m.push (0, 0, 0, 1);
                return m;
            }
        };
    };

    self.clearSTLReaders = function() {
        stlReaders = {};
    };

    self.getSTLReader = function(file) {
        return stlReaders[file];
    };

    self.isSTLFileValid = function(file) {
        return self.loadSTLFile(file).then(function (r) {
            return ! ! r;
        });
    };

    self.isSTLUrlValid = function(url) {
        return self.loadSTLURL(url).then(function (r) {
            return ! ! r;
        });
    };

    self.loadSTLFile = function(file) {
        var fileName = file.name || file;

        var url = requestSender.formatUrl('downloadFile', {
            '<simulation_id>': appState.models.simulation.simulationId,
            '<simulation_type>': SIREPO.APP_SCHEMA.simulationType,
            '<filename>': self.stlFileType + '.' + fileName,
        });
        return self.loadSTLURL(url).then(function (r) {
            return r;
        });
    };

    self.loadSTLURL = function(url) {
        var r = vtk.IO.Geometry.vtkSTLReader.newInstance();
        return r.setUrl(url)
            .then(function() {
                return r;
        }, function (err) {
            throw new Error(url + ': Invalid or missing .stl: ' +
            (err.xhr ? err.xhr.status + ' (' + err.xhr.statusText + ')' : err));
        })
            .catch(function (e) {
                $rootScope.$apply(function () {
                    errorService.alertText(e);
                });
            });
    };

    self.removeSTLReader = function(file) {
        if (stlReaders[file]) {
            delete stlReaders[file];
        }
    };

    self.cylinderSection = function(center, axis, radius, height, planes) {
        var startAxis = [0, 0, 1];
        var startOrigin = [0, 0, 0];
        var cylBounds = [-radius, radius, -radius, radius, -height/2.0, height/2.0];
        var cyl = vtk.Common.DataModel.vtkCylinder.newInstance({
            radius: radius,
            center: startOrigin,
            axis: startAxis
        });

        var pl = planes.map(function (p) {
            return vtk.Common.DataModel.vtkPlane.newInstance({
                normal: p.norm || startAxis,
                origin: p.origin || startOrigin
            });
        });

        // perform the sectioning
        var section = vtk.Common.DataModel.vtkImplicitBoolean.newInstance({
            operation: 'Intersection',
            functions: [cyl, pl[0], pl[1], pl[2], pl[3]]
        });

        var sectionSample = vtk.Imaging.Hybrid.vtkSampleFunction.newInstance({
            implicitFunction: section,
            modelBounds: cylBounds,
            sampleDimensions: [32, 32, 32]
        });

        var sectionSource = vtk.Filters.General.vtkImageMarchingCubes.newInstance();
        sectionSource.setInputConnection(sectionSample.getOutputPort());
        // this transformation adapted from VTK cylinder source - we don't "untranslate" because we want to
        // rotate in place, not around the global origin
        vtk.Common.Core.vtkMatrixBuilder
            .buildFromRadian()
            //.translate(...center)
            .translate(center[0], center[1], center[2])
            .rotateFromDirections(startAxis, axis)
            .apply(sectionSource.getOutputData().getPoints().getData());
       return sectionSource;
    };

    self.setColorScalars = function(data, color) {
        var pts = data.getPoints();
        var n = color.length * (pts.getData().length / pts.getNumberOfComponents());
        var pd = data.getPointData();
        var s = pd.getScalars();
        var rgb = s ? s.getData() : new window.Uint8Array(n);
        for (var i = 0; i < n; i += color.length) {
            for (var j = 0; j < color.length; ++j) {
                rgb[i + j] = color[j];
            }
        }
        pd.setScalars(
            vtk.Common.Core.vtkDataArray.newInstance({
                name: 'color',
                numberOfComponents: color.length,
                values: rgb,
            })
        );

        data.modified();
    };

    self.stlFileType = 'stl-file';

    self.vtkPlot = function(scope, element) {

        scope.element = element[0];
        var requestData = plotting.initAnimation(scope);

        scope.windowResize = utilities.debounce(function() {
            scope.resize();
        }, 250);

        scope.$on('$destroy', function() {
            scope.destroy();
            scope.element = null;
            $($window).off('resize', scope.windowResize);
        });

        scope.$on(
            scope.modelName + '.changed',
            function() {
                scope.prevFrameIndex = -1;
                if (scope.modelChanged) {
                    scope.modelChanged();
                }
                panelState.clear(scope.modelName);
                requestData();
            });
        scope.isLoading = function() {
            return panelState.isLoading(scope.modelName);
        };
        $($window).resize(scope.windowResize);

        scope.init();
        if (appState.isLoaded()) {
            requestData();
        }
    };

    // "Superclass" for representation of vtk source objects in ViewPort coordinates
    // Note this means that vpObjects are implicitly two-dimensional
    // A vpObject is assumed to have corners and edges connecting them, but no other
    // intrinsic properties
    self.vpObject = function(vtkSource, renderer) {

        var svc = self;
        var vpObj = {};

        var worldCoord = vtk.Rendering.Core.vtkCoordinate.newInstance({
            renderer: renderer
        });
        worldCoord.setCoordinateSystemToWorld();

        // arbitrary configuration
        vpObj.defaultCfg = {};

        vpObj.worldReady = false;

        vpObj.source = vtkSource;
        vpObj.wCoord = worldCoord;
        vpObj.worldCorners = wCorners();
        vpObj.worldEdges = {};

        vpObj.viewportCorners = [];
        vpObj.viewportEdges = {};

        // Override in subclass
        // world geometry does not change so they can be set once

        vpObj.wEdgesForDimension = function(dim) {
            return vpObj.worldEdges[dim];
        };

        vpObj.boundingRect = function() {
            var vpe = vpObj.vpExtrema();
            var extrema = vpe.x.concat(vpe.y);
            var xCoords = [];
            var yCoords = [];
            extrema.forEach(function (arr) {
                arr.forEach(function (p) {
                    xCoords.push(p.x);
                    yCoords.push(p.y);
                });
            });
            return geometry.rect(
                geometry.point(Math.min.apply(null, xCoords), Math.min.apply(null, yCoords)),
                geometry.point(Math.max.apply(null, xCoords), Math.max.apply(null, yCoords))
            );
        };

        // an external edge has all other corners on the same side of the line it defines
        vpObj.externalVpEdgesForDimension = function (dim) {
            var ext = [];
            vpObj.vpEdgesForDimension(dim).forEach(function (edge) {
                var numCorners = 0;
                var compCount = 0;
                for(var i in geometry.basis) {
                    var otherDim = geometry.basis[i];
                    if (otherDim === dim) {
                        continue;
                    }
                    var otherEdges = vpObj.vpEdgesForDimension(otherDim);
                    for(var j = 0; j < otherEdges.length; ++j) {
                        var otherEdgeCorners = otherEdges[j].points();
                        for(var k = 0; k <= 1; ++k) {
                            var n = edge.line().comparePoint(otherEdgeCorners[k]);
                            compCount += n;
                            if (n !== 0) {
                                numCorners++;
                            }
                        }
                    }
                }
                ext.push(Math.abs(compCount) === numCorners ? edge : null);
            });
            return ext;
        };

        vpObj.initializeWorld = function() {
            if (! vpObj.worldReady) {
                vpObj.worldReady = true;
            }
        };

        vpObj.localCoordFromWorld = function (point) {
            return svc.localCoordFromWorld(vpObj.wCoord, point);
        };

        vpObj.localCoordArrayFromWorld = function (arr) {
            return arr.map(function (p) {
                return vpObj.localCoordFromWorld(p);
            });
        };

        vpObj.vpCorners = function() {
            return vpObj.localCoordArrayFromWorld(vpObj.worldCorners);
        };

        vpObj.vpEdges = function() {
            var ee = {};
            var es = vpObj.worldEdges;
            for (var e in es) {
                var edges = es[e];
                var lEdges = [];
                for (var i = 0; i < edges.length; ++i) {
                    var ls = edges[i];
                    var wpts = ls.points();
                    var lpts = [];
                    for (var j = 0; j < wpts.length; ++j) {
                        lpts.push(vpObj.localCoordFromWorld(wpts[j]));
                    }
                    var lEdge = geometry.lineSegment(lpts[0], lpts[1]);
                    lEdges.push(lEdge);
                }
                ee[e] = lEdges;
            }
            return ee;
        };

        vpObj.vpEdgesForDimension = function (dim) {
            return vpObj.vpEdges()[dim];
        };

        // points on the screen that have the largest and smallest values in each dimension
        vpObj.vpExtrema = function() {
            var ex = {};
            // just x and y
            var dims = geometry.basis.slice(0, 2);
            var rev = [false, true];
            dims.forEach(function (dim) {
                ex[dim] = [];
                for( var j in rev ) {
                    ex[dim].push(geometry.extrema(vpObj.vpCorners(), dim, rev[j]));
                }
            });
            return ex;
        };

        function wCorners() {
            // [x0, x1, y0, y1, z0, z1]
            var b = vpObj.source.getOutputData().getBounds();
            return [
                geometry.pointFromArr([b[0], b[2], b[4]]),
                geometry.pointFromArr([b[0], b[2], b[5]]),
                geometry.pointFromArr([b[0], b[3], b[4]]),
                geometry.pointFromArr([b[0], b[3], b[5]]),
                geometry.pointFromArr([b[1], b[2], b[4]]),
                geometry.pointFromArr([b[1], b[2], b[5]]),
                geometry.pointFromArr([b[1], b[3], b[4]]),
                geometry.pointFromArr([b[1], b[3], b[5]])
            ];
        }

        return vpObj;
    };


    // Takes a vtk cube source and renderer and returns a box in viewport coordinates with a bunch of useful
    // geometric properties and methods
    self.vpBox = function(vtkCubeSource, renderer) {

        var box = self.vpObject(vtkCubeSource, renderer);
        box.defaultCfg = {
            edgeCfg: {
                x: { sense: 1 },
                y: { sense: 1 },
                z: { sense: 1 },
            }
        };

        // box corners are defined thus:
        //
        //   2------X2------3    6------X3------7
        //   |              |    |              |
        //   |              |    |              |
        //   Y0   Front    Y1    Y2   Back     Y3
        //   |              |    |              |
        //   |              |    |              |
        //   0------X0------1    4------X1------5
        //
        //TODO(mvk): Order is important only for axis direction and should be supplied externally
        var edgeCornerPairs = {
            x: [[0, 1], [4, 5], [2, 3], [6, 7]],
            y: [[0, 2], [1, 3], [4, 6], [5, 7]],
            z: [[4, 0], [5, 1], [6, 2], [7, 3]]
        };

        var initWorldFn = box.initializeWorld;
        //box.initializeWorld = function () {
        box.initializeWorld = function (cfg) {
            if (! box.worldReady) {
                cfg = cfg || box.defaultCfg;
                for (var dim in cfg.edgeCfg) {
                    var c = cfg.edgeCfg[dim];
                    for (var i = 0; i < edgeCornerPairs[dim].length; ++i) {
                        if (c.sense < 0) {
                            edgeCornerPairs[dim][i].reverse();
                        }
                    }
                }
                box.worldCorners = wCorners();
                box.worldEdges = wEdges();
            }
            initWorldFn();
        };

        function wCenter() {
            return geometry.pointFromArr(box.source.getCenter());
        }

        // Convenience for indexed looping
        function wLength() {
            return [
                box.source.getXLength(),
                box.source.getYLength(),
                box.source.getZLength()
            ];
        }

        // Convenience for basis looping
        function wl() {
            var l = wLength();
            return {
                x: l[0],
                y: l[1],
                z: l[2]
            };
        }

        function wCorners() {
            var ctr = wCenter();
            var corners = [];

            var sides = [-0.5, 0.5];
            var len = wLength();
            for(var i in sides) {
                for (var j in sides) {
                    for (var k in sides) {
                        var s = [sides[k], sides[j], sides[i]];
                        var c = [];
                        for(var l = 0; l < 3; ++l) {
                            c.push(ctr.coords()[l] + s[l] * len[l]);
                        }
                        corners.push(geometry.pointFromArr(c));
                    }
                }
            }
            return corners;
        }

        function wEdges() {
            var c = box.worldCorners;
            var e = {};
            for (var dim in edgeCornerPairs) {
                var lines = [];
                for (var j in  edgeCornerPairs[dim]) {
                    var p = edgeCornerPairs[dim][j];
                    var l = geometry.lineSegment(c[p[0]], c[p[1]]);
                    lines.push(l);
                }
                e[dim] = lines;
            }
            return e;
        }

        box.vpCenterLineForDimension = function (dim) {
            return vpCenterLines()[dim];
        };

        function vpCenterLines() {
            var ctr = wCenter().coords();
            var cls = {};
            var lens = wl();
            var m = [
                [lens.x / 2, 0, 0],
                [0, lens.y / 2, 0],
                [0, 0, lens.z / 2]
            ];
            var tx = geometry.transform(m);
            for(var dim in geometry.basisVectors) {
                var txp = tx.doTransform(geometry.basisVectors[dim]);
                var p1 = box.localCoordFromWorld(geometry.pointFromArr(
                    geometry.vectorSubtract(ctr, txp)
                ));
                var p2 = box.localCoordFromWorld(geometry.pointFromArr(
                    geometry.vectorAdd(ctr, txp)
                ));
                cls[dim] = geometry.lineSegment(p1, p2);
            }
            return cls;
        }

        return box;
    };

    self.vpSTL = function(stlReader, renderer) {
        var stl = self.vpObject(stlReader, renderer);
        return stl;
    };

    self.addActors = function(renderer, actorArr) {
        actorArr.forEach(function(actor) {
            self.addActor(renderer, actor);
        });
    };

    self.addActor = function(renderer, actor) {
        if (! actor) {
            return;
        }
        renderer.addActor(actor);
    };

    self.removeActors = function(renderer, actorArr) {
        if (! actorArr) {
            renderer.getActors().forEach(function(actor) {
                renderer.removeActor(actor);
            });
            return;
        }
        actorArr.forEach(function(actor) {
            self.removeActor(renderer, actor);
        });
        actorArr.length = 0;
    };

    self.removeActor = function(renderer, actor) {
        if (! actor ) {
            return;
        }
        renderer.removeActor(actor);
    };

    self.showActors = function(renderWindow, arr, doShow, visibleOpacity, hiddenOpacity) {
        arr.forEach(function (a) {
            self.showActor(renderWindow, a, doShow, visibleOpacity, hiddenOpacity, true);
        });
        renderWindow.render();
    };

    self.showActor = function(renderWindow, a, doShow, visibleOpacity, hiddenOpacity, waitToRender) {
        a.getProperty().setOpacity(doShow ? visibleOpacity || 1.0 : hiddenOpacity || 0.0);
        if (! waitToRender) {
            renderWindow.render();
        }
    };

    self.localCoordFromWorld = function (vtkCoord, point) {
        // this is required to do conversions for different displays/devices
        var pixels = window.devicePixelRatio;
        vtkCoord.setCoordinateSystemToWorld();
        vtkCoord.setValue(point.coords());
        var lCoord = vtkCoord.getComputedLocalDisplayValue();
        return geometry.point(lCoord[0] / pixels, lCoord[1] / pixels);
    };

    self.vtkUserMatrixFromMatrix = function(matrix) {
        var um = [];
        matrix.forEach(function (row) {
            um = um.concat(row);
            um.push(0);
        });
        um = um.concat([0, 0, 0, 1]);
        return um;
    };

    self.worldCoordFromLocal = function (coord, point, view) {
        var pixels = window.devicePixelRatio;
        var newPoint = [pixels * point.coords()[0], pixels * point.coords()[1]];
        // must first convert from "localDisplay" to "display"  - this is the inverse of
        // what is done by vtk to get from display to localDisplay
        var newPointView = [newPoint[0], view.getFramebufferSize()[1] - newPoint[1] - 1];
        coord.setCoordinateSystemToDisplay();
        coord.setValue(newPointView);
        return coord.getComputedWorldValue();
    };

    return self;
});

SIREPO.app.directive('stlFileChooser', function(validationService, vtkPlotting) {
    return {
        restrict: 'A',
        scope: {
            description: '=',
            url: '=',
            inputFile: '=',
            model: '=',
            require: '<',
            title: '@',
        },
        template: [
            '<div data-file-chooser=""  data-url="url" data-input-file="inputFile" data-validator="validate" data-title="title" data-file-formats=".stl" data-description="description" data-require="require">',
            '</div>',
        ].join(''),
        controller: function($scope) {
            $scope.validate = function (file) {
                $scope.url = URL.createObjectURL(file);
                return vtkPlotting.isSTLUrlValid($scope.url).then(function (ok) {
                    return ok;
                });
            };
            $scope.validationError = '';
        },
        link: function(scope, element, attrs) {

        },
    };
});

SIREPO.app.directive('stlImportDialog', function(appState, fileManager, fileUpload, vtkPlotting, requestSender) {
    return {
        restrict: 'A',
        scope: {
            description: '@',
            title: '@',
        },
        template: [
            '<div class="modal fade" id="simulation-import" tabindex="-1" role="dialog">',
              '<div class="modal-dialog modal-lg">',
                '<div class="modal-content">',
                  '<div class="modal-header bg-info">',
                    '<button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>',
                    '<div data-help-button="{{ title }}"></div>',
                    '<span class="lead modal-title text-info">{{ title }}</span>',
                  '</div>',
                  '<div class="modal-body">',
                    '<div class="container-fluid">',
                        '<form>',
                        '<div data-stl-file-chooser="" data-input-file="inputFile" data-url="fileURL" data-title="title" data-description="description" data-require="true"></div>',
                          '<div class="col-sm-6 pull-right">',
                            '<button data-ng-click="importStlFile(inputFile)" class="btn btn-primary" data-ng-class="{\'disabled\': isMissingImportFile() }">Import File</button>',
                            ' <button data-dismiss="modal" class="btn btn-default">Cancel</button>',
                          '</div>',
                        '</form>',
                    '</div>',
                  '</div>',
                '</div>',
              '</div>',
            '</div>',
        ].join(''),
        controller: function($scope) {
            $scope.inputFile = null;
            $scope.fileURL = null;
            $scope.isMissingImportFile = function() {
                return ! $scope.inputFile;
            };
            $scope.fileUploadError = '';
            $scope.isUploading = false;
            $scope.title = $scope.title || 'Import STL File';
            $scope.description = $scope.description || 'Select File';

            $scope.importStlFile = function(inputFile) {
                if (! inputFile) {
                    return;
                }
                newSimFromSTL(inputFile);
            };

            function upload(inputFile, data) {
                var simId = data.models.simulation.simulationId;
                fileUpload.uploadFileToUrl(
                    inputFile,
                    $scope.isConfirming
                        ? {
                            confirm: $scope.isConfirming,
                        }
                        : null,
                    requestSender.formatUrl(
                        'uploadFile',
                        {
                            '<simulation_id>': simId,
                            '<simulation_type>': SIREPO.APP_SCHEMA.simulationType,
                            '<file_type>': vtkPlotting.stlFileType,
                        }),
                    function(d) {
                        $('#simulation-import').modal('hide');
                        $scope.inputFile = null;
                        URL.revokeObjectURL($scope.fileURL);
                        $scope.fileURL = null;
                        requestSender.localRedirectHome(simId);
                    }, function (err) {
                        throw new Error(inputFile + ': Error during upload ' + err);
                    });
            }

            function newSimFromSTL(inputFile) {
                var url = $scope.fileURL;
                var model = appState.setModelDefaults(appState.models.simulation, 'simulation');
                model.name = inputFile.name.substring(0, inputFile.name.indexOf('.'));
                model.folder = fileManager.getActiveFolderPath();
                model.conductorFile = inputFile.name;
                appState.newSimulation(
                    model,
                    function (data) {
                        $scope.isUploading = false;
                        upload(inputFile, data);
                    },
                    function (err) {
                        throw new Error(inputFile + ': Error creating simulation ' + err);
                    }
                );
            }

        },
        link: function(scope, element) {
            $(element).on('show.bs.modal', function() {
                $('#file-import').val(null);
                scope.fileUploadError = '';
                scope.isUploading = false;
            });
            scope.$on('$destroy', function() {
                $(element).off();
            });
        },
    };});


// will be axis display
SIREPO.app.directive('vtkAxes', function(appState, frameCache, panelState, requestSender, plotting, vtkAxisService, vtkPlotting, layoutService, utilities, geometry) {
    return {
        restrict: 'A',
        scope: {
            axisCfg: '<',
            boundObj: '<',
            height: '<',
            width: '<',
        },
        template: [
            '<svg data-ng-attr-width="{{ width }}" data-ng-attr-height="{{ height }}">',
            '<g class="vtk-axes">',
                '<g data-ng-repeat="dim in geometry.basis">',
                    '<g class="{{ dim }} axis"></g>',
                    '<text class="{{ dim }}-axis-label"></text>',
                    '<text class="{{ dim }} axis-end low"></text>',
                    '<text class="{{ dim }} axis-end high"></text>',
                '</g>',
                '<g data-ng-repeat="dim in geometry.basis">',
                    '<g class="{{ dim }}-axis-central" data-ng-show="axisCfg[dim].showCentral">',
                        '<line style="stroke: gray;" stroke-dasharray="5,5" data-ng-attr-x1="{{ centralAxes[dim].x[0] }}" data-ng-attr-y1="{{ centralAxes[dim].y[0] }}" data-ng-attr-x2="{{ centralAxes[dim].x[1] }}" data-ng-attr-y2="{{ centralAxes[dim].y[1] }}" />',
                    '</g>',
                '</g>',
            '</g>',
            '</svg>',
        ].join(''),
        controller: function($scope, $element) {

            $scope.axesMargins = {
                x: { width: 16.0, height: 0.0 },
                y: { width: 0.0, height: 16.0 }
            };
            $scope.centralAxes = {
                x: { x: [-0.5, 0.5], y: [-0.5, 0.5] },
                y: { x: [-0.5, 0.5], y: [-0.5, 0.5] },
                z: { x: [-0.5, 0.5], y: [-0.5, 0.5] },
            };
            $scope.geometry = geometry;
            $scope.margin = {top: 50, right: 23, bottom: 50, left: 75};

            $scope.isDegenerate = function(dim) {
                return $scope.centralAxes[dim].x[0] === $scope.centralAxes[dim].x[1] &&
                    $scope.centralAxes[dim].y[0] === $scope.centralAxes[dim].y[1];
            };

            var axes = {
                x: layoutService.plotAxis($scope.margin, 'x', 'bottom', refresh, utilities),
                y: layoutService.plotAxis($scope.margin, 'y', 'bottom', refresh, utilities),
                z: layoutService.plotAxis($scope.margin, 'z', 'left', refresh, utilities)
            };

            var axisCfgDefault = {};
            geometry.basis.forEach(function (dim) {
                axisCfgDefault[dim] = {};
                axisCfgDefault[dim].color = '#ff0000';
                axisCfgDefault[dim].dimLabel = dim;
                axisCfgDefault[dim].label = dim;
                axisCfgDefault[dim].max = -0.5;
                axisCfgDefault[dim].min = 0.5;
                axisCfgDefault[dim].numPoints = 10;
                axisCfgDefault[dim].screenDim = dim === 'z' ? 'y' : 'x';
                axisCfgDefault[dim].showCentral = false;
            });

            var axisCfg = axisCfgDefault;

            var d3self = d3.selectAll($element);
            var lastSize = [1, 1];

            function refresh() {
                //srdbg('axes refresh');

                var size = [$($element).width(), $($element).height()];
                var pos = $($element).offset();
                //srdbg('axes pos', pos, 'sz', size);
                var screenRect = geometry.rect(
                    geometry.point(
                        $scope.axesMargins.x.width,
                        $scope.axesMargins.y.height
                    ),
                    geometry.point(
                        size[0] - $scope.axesMargins.x.width,
                        size[1] - $scope.axesMargins.y.height
                    )
                );

                var dsz = [size[0] / lastSize[0], size[1] / lastSize[1]];
                // If an axis is shorter than this, don't display it -- the ticks will
                // be cramped and unreadable
                var minAxisDisplayLen = 50;

                for (var i in geometry.basis) {

                    var dim = geometry.basis[i];
                    var cfg = axisCfg[dim];

                    var screenDim = cfg.screenDim;
                    var isHorizontal = screenDim === 'x';
                    var axisEnds = isHorizontal ? ['◄', '►'] : ['▼', '▲'];
                    var perpScreenDim = isHorizontal ? 'y' : 'x';

                    var showAxisEnds = false;
                    var axisSelector = '.' + dim + '.axis';
                    var axisLabelSelector = '.' + dim + '-axis-label';

                    // sort the external edges so we'll preferentially pick the left and bottom
                    var externalEdges = $scope.boundObj.externalVpEdgesForDimension(dim)
                        .sort(vtkAxisService.edgeSorter(perpScreenDim, ! isHorizontal));
                    var seg = geometry.bestEdgeAndSectionInBounds(
                        externalEdges, screenRect, dim, false
                    );
                    //srdbg(dim, 'best edge', seg);
                    var cl = $scope.boundObj.vpCenterLineForDimension(dim);
                    var cli = screenRect.boundaryIntersectionsWithSeg(cl);
                    if (cli && cli.length == 2) {
                        $scope.centralAxes[dim].x = [cli[0].x, cli[1].x];
                        $scope.centralAxes[dim].y = [cli[0].y, cli[1].y];
                    }

                    if (! seg) {
                        // param to show arrow ends?
                        /*
                        // all possible axis ends offscreen, so try a centerline
                        var cl = $scope.boundObj.vpCenterLineForDimension(dim);
                        seg = geometry.bestEdgeAndSectionInBounds([cl], $scope.boundObj.boundingRect(), dim, false);
                        if (! seg) {
                            // don't draw axes
                            d3self.select(axisSelector).style('opacity', 0.0);
                            d3self.select(axisLabelSelector).style('opacity', 0.0);
                            continue;
                        }
                        showAxisEnds = true;
                        */
                        d3self.select(axisSelector).style('opacity', 0.0);
                        d3self.select(axisLabelSelector).style('opacity', 0.0);
                        continue;
                    }
                    d3self.select(axisSelector).style('opacity', 1.0);
                    //d3self.select(axisSelector).style('stroke', $scope.cfg.color);

                    var fullSeg = seg.full;
                    var clippedSeg = seg.clipped;
                    var reverseOnScreen = vtkAxisService.shouldReverseOnScreen(
                        $scope.boundObj.vpEdgesForDimension(dim)[seg.index], screenDim
                    );
                    var sortedPts = geometry.sortInDimension(clippedSeg.points(), screenDim, false);
                    var axisLeft = sortedPts[0].x;
                    var axisTop = sortedPts[0].y;
                    var axisRight = sortedPts[1].x;
                    var axisBottom = sortedPts[1].y;
                    //var axisLeft = sortedPts[0].x * dsz[0];
                    //var axisTop = sortedPts[0].y * dsz[1];
                    //var axisRight = sortedPts[1].x * dsz[0];
                    //var axisBottom = sortedPts[1].y * dsz[1];

                    var newRange = Math.min(fullSeg.length(), clippedSeg.length());
                    var radAngle = Math.atan(clippedSeg.slope());
                    if (! isHorizontal) {
                        radAngle -= Math.PI / 2;
                        if (radAngle < -Math.PI / 2) {
                            radAngle += Math.PI;
                        }
                    }
                    var angle = (180 * radAngle / Math.PI);

                    var allPts = geometry.sortInDimension(fullSeg.points().concat(clippedSeg.points()), screenDim, false);

                    var limits = reverseOnScreen ? [cfg.max, cfg.min] : [cfg.min, cfg.max];
                    var newDom = [cfg.min, cfg.max];
                    // 1st 2, last 2 points
                    for (var m = 0; m < allPts.length; m += 2) {
                        // a point may coincide with its successor
                        var d = allPts[m].dist(allPts[m + 1]);
                        if (d != 0) {
                            var j = Math.floor(m / 2);
                            var k = reverseOnScreen ? 1 - j : j;
                            var l1 = limits[j];
                            var l2 = limits[1 - j];
                            var part = (l1 - l2) * d / fullSeg.length();
                            var newLimit = l1 - part;
                            newDom[k] = newLimit;
                        }
                    }
                    var xform = 'translate(' + axisLeft + ',' + axisTop + ') ' +
                        'rotate(' + angle + ')';
                    //srdbg('xform', xform, dsz);

                    axes[dim].scale.domain(newDom).nice();
                    axes[dim].scale.range([reverseOnScreen ? newRange : 0, reverseOnScreen ? 0 : newRange]);

                    // this places the axis tick labels on the appropriate side of the axis
                    var outsideCorner = geometry.sortInDimension($scope.boundObj.vpCorners(), perpScreenDim, isHorizontal)[0];
                    var bottomOrLeft = outsideCorner.equals(sortedPts[0]) || outsideCorner.equals(sortedPts[1]);
                    if (isHorizontal) {
                        axes[dim].svgAxis.orient(bottomOrLeft ? 'bottom' : 'top');
                    }
                    else {
                        axes[dim].svgAxis.orient(bottomOrLeft ? 'left' : 'right');
                    }


                    if (showAxisEnds) {
                        axes[dim].svgAxis.ticks(0);
                        d3self.select(axisSelector).call(axes[dim].svgAxis);
                    }
                    else {
                        axes[dim].updateLabelAndTicks({
                            width: newRange,
                            height: newRange
                        }, d3.select);
                    }

                    d3self.select(axisSelector).attr('transform', xform);

                    var dimLabel = cfg.dimLabel;
                    d3self.selectAll(axisSelector + '-end')
                        .style('opacity', showAxisEnds ? 1 : 0);

                    var tf = axes[dim].svgAxis.tickFormat();
                    if (tf) {
                        d3self.select(axisSelector + '-end.low')
                            .text(axisEnds[0] + ' ' + dimLabel + ' ' + tf(reverseOnScreen ? newDom[1] : newDom[0]) + axes[dim].unitSymbol + axes[dim].units)
                            .attr('x', axisLeft)
                            .attr('y', axisTop)
                            .attr('transform', 'rotate(' + (angle) + ', ' + axisLeft + ', ' + axisTop + ')');

                        d3self.select(axisSelector + '-end.high')
                            .attr('text-anchor', 'end')
                            .text(tf(reverseOnScreen ? newDom[0] : newDom[1]) + axes[dim].unitSymbol + axes[dim].units + ' ' + dimLabel + ' ' + axisEnds[1])
                            .attr('x', axisRight)
                            .attr('y', axisBottom)
                            .attr('transform', 'rotate(' + (angle) + ', ' + axisRight + ', ' + axisBottom + ')');
                    }

                    // counter-rotate the tick labels
                    var labels = d3self.selectAll(axisSelector + ' text');
                    labels.attr('transform', 'rotate(' + (-angle) + ')');
                    d3self.select(axisSelector + ' .domain').style({'stroke': 'none'});
                    d3self.select(axisSelector).style('opacity', newRange < minAxisDisplayLen ? 0 : 1);

                    var labelSpace = 2 * plotting.tickFontSize(d3self.select(axisSelector + '-label'));
                    var labelSpaceX = (isHorizontal ? Math.sin(radAngle) : Math.cos(radAngle)) * labelSpace;
                    var labelSpaceY = (isHorizontal ? Math.cos(radAngle) : Math.sin(radAngle)) * labelSpace;
                    var labelX = axisLeft + (bottomOrLeft ? -1 : 1) * labelSpaceX + (axisRight - axisLeft) / 2.0;
                    var labelY = axisTop + (bottomOrLeft ? 1 : -1) * labelSpaceY + (axisBottom - axisTop) / 2.0;
                    var labelXform = 'rotate(' + (isHorizontal ? 0 : -90) + ' ' + labelX + ' ' + labelY + ')';

                    d3self.select('.' + dim + '-axis-label')
                        .attr('x', labelX)
                        .attr('y', labelY)
                        .attr('transform', labelXform)
                        .style('opacity', (showAxisEnds || newRange < minAxisDisplayLen) ? 0 : 1);

                    // these optional axes go through (0, 0, 0)


                }
                lastSize = size;
            }

            function init() {
                //srdbg('axes init');
                for (var dim in axes) {
                    axes[dim].init();
                    axes[dim].svgAxis.tickSize(0);
                }
                rebuildAxes();
            }

            function rebuildAxes() {
                //srdbg('update axes', axisCfg);
                for (var dim in axes) {
                    var cfg = axisCfg[dim];
                    axes[dim].values = plotting.linearlySpacedArray(cfg.min, cfg.max, cfg.numPoints);
                    axes[dim].scale.domain([cfg.min, cfg.max]);
                    axes[dim].parseLabelAndUnits(cfg.label);
                }
            }

            appState.whenModelsLoaded($scope, function() {
                init();
            });

            $scope.$on('axes.refresh', function () {
                //srdbg('axes.refresh');
                refresh();
            });

            // may not need this refresh?
            $scope.$watch('boundObj', function (d) {
                if (d) {
                    //refresh();
                }
            });

            $scope.$watch('axisCfg', function (d) {
                if (d) {
                    axisCfg = $scope.axisCfg;
                    rebuildAxes();
                    refresh();
                }
            });
        },

    };
});

// will be axis functions
SIREPO.app.service('vtkAxisService', function(appState, panelState, requestSender, frameCache, plotting, vtkPlotting, layoutService, utilities, geometry) {

    var svc = {};

    svc.edgeSorter = function(dim, shouldReverse) {
        return function(e1, e2) {
            if (! e1) {
                if (! e2) {
                    return 0;
                }
                return 1;
            }
            if (! e2) {
                return -1;
            }
            var pt1 = geometry.sortInDimension(e1.points(), dim, shouldReverse)[0];
            var pt2 = geometry.sortInDimension(e2.points(), dim, shouldReverse)[0];
            return (shouldReverse ? -1 : 1) * (pt2[dim] - pt1[dim]);
        };
    };

    svc.shouldReverseOnScreen = function(edge, screenDim) {
        return edge.points()[1][screenDim] < edge.points()[0][screenDim];
    };

    return svc;
});

// General-purpose vtk display
SIREPO.app.directive('vtkDisplay', function(appState, geometry, panelState, plotting, plotToPNG, vtkPlotting, vtkService, vtkUtils, utilities, $document, $window) {

    return {
        restrict: 'A',
        //transclude: {
        //    visabilityControlSlot: '?visabilityControl',
        //},
        scope: {
            axisCfg: '<',
            axisObj: '<',
            enableAxes: '=',
            enableSelection: '=',
            eventHandlers: '<',
            modelName: '@',
            reportId: '<',
            showBorder: '@',
        },
        templateUrl: '/static/html/vtk-display.html' + SIREPO.SOURCE_CACHE_KEY,
        controller: function($scope, $element) {

            $scope.vtkUtils = vtkUtils;
            $scope.markerState = {
                enabled: true,
            };
            $scope.modeText = {};
            $scope.modeText[vtkUtils.INTERACTION_MODE_MOVE] = 'Click and drag to rotate';
            $scope.modeText[vtkUtils.INTERACTION_MODE_SELECT] = 'Control-click an object to select';
            $scope.selection = null;

            // common
            var api = {
                getMode: getInteractionMode,
                setBg: setBgColor,
                setCam: setCam,
                setMarker: setMarker,
            };

            var cam = null;
            var canvas3d = null;
            var didPan = false;
            var fsRenderer = null;
            var isDragging = false;
            var isPointerUp = true;
            var marker = null;
            var renderer = null;
            var renderWindow = null;
            var snapshotCanvas = null;
            var snapshotCtx = null;

            function getInteractionMode() {
                return $scope.interactionMode;
            }

            // supplement or override these event handlers
            var eventHandlers = {
                onpointerdown: function (evt) {
                    isDragging = false;
                    isPointerUp = false;
                },
                onpointermove: function (evt) {
                    if (isPointerUp) {
                        return;
                    }
                    isDragging = true;
                    didPan = didPan || evt.shiftKey;
                    $scope.side = null;
                    utilities.debounce(refresh, 100)();
                },
                onpointerup: function (evt) {
                    isDragging = false;
                    isPointerUp = true;
                    refresh(true);
                },
                onwheel: function (evt) {
                    utilities.debounce(
                        function() {
                            refresh(true);
                        },
                        100)();
                }
            };

            function ondblclick(evt) {
                setCam();
                refresh();
            }

            function setBgColor(hexColor) {
                renderer.setBackground(vtk.Common.Core.vtkMath.hex2float(hexColor));
            }

            function setCam(pos, vu) {
                if (! fsRenderer) {
                    return;
                }
                var cam = renderer.get().activeCamera;
                //cam.setPosition(...(pos || [1, 0, 0]));
                var p = pos || [1, 0, 0];
                cam.setPosition(p[0], p[1], p[2]);
                cam.setFocalPoint(0, 0, 0);
                //cam.setViewUp(...(vu || [0, 0, 1]));
                var v = vu || [0, 0, 1];
                cam.setViewUp(v[0], v[1], v[2]);
                renderer.resetCamera();
                if (marker) {
                    marker.updateMarkerOrientation();
                }
                renderWindow.render();
            }

            function setMarker(m) {
                marker = m;
                setMarkerVisible();
            }

            function setMarkerVisible() {
                if (! marker) {
                    return;
                }
                marker.setEnabled($scope.markerState.enabled);
                renderWindow.render();
            }

            $scope.hasMarker = function() {
                return ! ! marker;
            };

            $scope.init = function() {
                //srdbg('vtk init', $scope);
                var rw = angular.element($($element).find('.vtk-canvas-holder'))[0];
                var body = angular.element($($document).find('body'))[0];
                var hdlrs = $scope.eventHandlers || {};

                // vtk adds keypress event listeners to the BODY of the entire document, not the render
                // container
                var hasBodyEvt = Object.keys(hdlrs).some(function (e) {
                    return ['keypress', 'keydown', 'keyup'].indexOf(e) >= 0;
                });
                if (hasBodyEvt) {
                    var bodyAddEvtLsnr = body.addEventListener;
                    body.addEventListener = function (type, listener) {
                        bodyAddEvtLsnr(type, hdlrs[type] ? hdlrs[type] : listener);
                    };
                }

                fsRenderer = vtk.Rendering.Misc.vtkFullScreenRenderWindow.newInstance({
                    background: [1, 1, 1, 1],
                    container: rw,
                    listenWindowResize: false,
                });
                renderer = fsRenderer.getRenderer();
                renderWindow = fsRenderer.getRenderWindow();
                var interactor = renderWindow.getInteractor();
                var mainView = renderWindow.getViews()[0];

                cam = renderer.get().activeCamera;

                var worldCoord = vtk.Rendering.Core.vtkCoordinate.newInstance({
                    renderer: renderer
                });
                worldCoord.setCoordinateSystemToWorld();

                // double click handled separately
                rw.addEventListener('dblclick', function (evt) {
                    ondblclick(evt);
                    if (hdlrs.ondblclick) {
                        hdlrs.ondblclick(evt);
                    }
                });
                Object.keys(eventHandlers).forEach(function (k) {
                    rw[k] = function (evt) {
                        eventHandlers[k](evt);
                        if (hdlrs[k]) {
                            hdlrs[k](evt);
                        }
                    };
                });

                canvas3d = $($element).find('canvas')[0];

                // this canvas is used to store snapshots of the 3d canvas
                snapshotCanvas = document.createElement('canvas');
                snapshotCtx = snapshotCanvas.getContext('2d');
                plotToPNG.addCanvas(snapshotCanvas, $scope.reportId);

                // allow ancestor scopes access to the renderer etc.
                $scope.$emit('vtk-init', {
                    api: api,
                    objects: {
                        camera: cam,
                        container: fsRenderer.getContainer(),
                        //listeners: lsnrs,
                        renderer: renderer,
                        window: renderWindow,
                    }
                });
            };

            $scope.canvasGeometry = function() {
                var vtkCanvasHolder = $($element).find('.vtk-canvas-holder')[0];
                return {
                    pos: $(vtkCanvasHolder).position(),
                    size: {
                        width: $(vtkCanvasHolder).width(),
                        height: $(vtkCanvasHolder).height()
                    }
                };
            };

            $scope.interactionMode = vtkUtils.INTERACTION_MODE_MOVE;

            $scope.setInteractionMode = function(mode) {
                $scope.interactionMode = mode;
                //renderWindow.getInteractor().setRecognizeGestures(mode === vtkUtils.INTERACTION_MODE_MOVE);
            };

            $scope.axisDirs = {
                dir: 1,
                x: {
                    camViewUp: [0, 0, 1]
                },
                y: {
                    camViewUp: [0, 0, 1]
                },
                z: {
                    camViewUp: [0, 1, 0]
                }
            };
            $scope.side = 'x';
            $scope.showSide = function(side) {
                if (side == $scope.side) {
                    $scope.axisDirs.dir *= -1;
                }
                $scope.side = side;
                var cp = geometry.basisVectors[side].map(function (c) {
                    return c * $scope.axisDirs.dir;
                });
                setCam(cp, $scope.axisDirs[side].camViewUp);
                refresh();
            };

            $scope.toggleMarker = function() {
                setMarkerVisible();
            };

            $scope.$on('$destroy', function() {
                $element.off();
                $($window).off('resize', resize);
                fsRenderer.getInteractor().unbindEvents();
                fsRenderer.delete();
                plotToPNG.removeCanvas($scope.reportId);
            });

            function cacheCanvas() {
                if (! snapshotCtx) {
                    return;
                }
                var w = parseInt(canvas3d.getAttribute('width'));
                var h = parseInt(canvas3d.getAttribute('height'));
                snapshotCanvas.width = w;
                snapshotCanvas.height = h;
                // this call makes sure the buffer is fresh (it appears)
                fsRenderer.getOpenGLRenderWindow().traverseAllPasses();
                snapshotCtx.drawImage(canvas3d, 0, 0, w, h);
            }

            function refresh(doCacheCanvas) {

                if ($scope.axisObj) {
                    $scope.$broadcast('axes.refresh');
                }

                if (doCacheCanvas) {
                    cacheCanvas();
                }
            }

            function resize(e) {
                //srdbg('VTK RESIZE');
                refresh();
            }

            appState.whenModelsLoaded($scope, function () {
                $scope.$on('vtk.selected', function (e, d) {
                    $scope.$applyAsync(function () {
                        $scope.selection = d;
                    });
                });
                $scope.init();
            });

            $($window).resize(resize);
        },

        //link: function link(scope, element) {
        //    vtkPlotting.vtkPlot(scope, element);
        //},
    };
});

// general-purpose vtk methods
SIREPO.app.service('vtkService', function(appState, panelState, requestSender, frameCache, plotting, vtkPlotting, layoutService, utilities, geometry) {
    var svc = {};
    return svc;
});

SIREPO.app.factory('vtkUtils', function() {

    var self = {};

    self.INTERACTION_MODE_MOVE = 'move';
    self.INTERACTION_MODE_SELECT = 'select';
    self.INTERACTION_MODES = [self.INTERACTION_MODE_MOVE, self.INTERACTION_MODE_SELECT];

    // Converts vtk colors ranging from 0 -> 255 to 0.0 -> 1.0
    // can't map, because we will still have a UINT8 array
    self.rgbToFloat = function (rgb) {
        var sc = [];
        for (var i = 0; i < rgb.length; ++i) {
            sc.push(rgb[i] / 255.0);
        }
        return sc;
    };

    // Converts vtk colors ranging from 0 -> 255 to 0.0 -> 1.0
    // can't map, because we will still have a UINT8 array
    self.floatToRGB = function (f) {
        var rgb = new window.Uint8Array(f.length);
        for (var i = 0; i < rgb.length; ++i) {
            rgb[i] = Math.floor(255 * f[i]);
        }
        return rgb;
    };

    return self;
});
