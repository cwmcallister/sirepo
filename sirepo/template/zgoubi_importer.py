# -*- coding: utf-8 -*-
u"""zgoubi datafile parser

:copyright: Copyright (c) 2018 RadiaSoft LLC.  All Rights Reserved.
:license: http://www.apache.org/licenses/LICENSE-2.0.html
"""
from __future__ import absolute_import, division, print_function
from pykern import pkresource
from pykern.pkdebug import pkdc, pkdlog, pkdp
from sirepo import simulation_db
from sirepo.template import elegant_common, zgoubi_parser
import math
import re

_SIM_TYPE = 'zgoubi'
_SCHEMA = simulation_db.get_schema(_SIM_TYPE)
_IGNORE_FIELDS = ['MULTIPOL.IL', 'MULTIPOL.NCE', 'MULTIPOL.NCS', 'YMY.label2', 'MULTIPOL.label2']
_DEGREE_TO_RADIAN_FIELDS = ['CHANGREF.ALE']
_MRAD_FIELDS = ['AUTOREF.ALE']
#TODO(pjm): check schema for [m] fields to get this list (but not beta)
_CM_FIELDS = ['l', 'X_E', 'LAM_E', 'X_S', 'LAM_S', 'XCE', 'YCE', 'R_0', 'dY', 'dZ', 'dS', 'YR', 'ZR', 'SR']


def import_file(text):
    data = simulation_db.default_data(_SIM_TYPE)
    beamline = []
    data['models']['beamlines'] = [
        {
            'name': 'BL1',
            'id': 1,
            'items': beamline,
        },
    ]
    models = zgoubi_parser.parse_file(text, 1)
    for el in models['elements']:
        _validate_model(el)
        if 'name' in el:
            data['models']['elements'].append(el)
            beamline.append(el['_id'])
        else:
            if el['type'] in data['models']:
                pkdlog('replacing existing {} model', el['type'])
            del el['_id']
            data['models'][el['type']] = el
    elegant_common.sort_elements_and_beamlines(data)
    return data


def _validate_field(model, field, model_info):
    if field in ('_id', 'type'):
        return
    assert field in model_info, \
        'unknown model field: {}.{}, value: {}'.format(model['type'], field, model[field])
    field_info = model_info[field]
    field_type = field_info[1]
    if field_type == 'Float':
        model[field] = float(model[field])
        mf = '{}.{}'.format(model['type'], field)
        if mf in _DEGREE_TO_RADIAN_FIELDS:
            model[field] *= math.pi / 180.0
        elif mf in _MRAD_FIELDS:
            model[field] /= 1000.0
        elif field in _CM_FIELDS and model['type'] != 'CAVITE':
            model[field] *= 0.01
    elif model['type'] == 'CHANGREF' and field == 'order' and model['format'] == 'new':
        res = ''
        model['order'] = re.sub(r'\s+$', '', model['order'])
        k = ''
        for v in model['order'].split(' '):
            if re.search(r'^[XYZ]', v):
                k = v
            else:
                if k[1] == 'R':
                    res += '{} {} '.format(k, float(v) * math.pi / 180.0)
                else:
                    res += '{} {} '.format(k, float(v) * 0.01)
        model['order'] = re.sub(r'\s+$', '', res)
    elif field_type in _SCHEMA['enum']:
        for v in _SCHEMA['enum'][field_type]:
            if v[0] == model[field]:
                return
        pkdlog('invalid enum value, {}.{} {}: {}', model['type'], field, field_type, model[field])
        model[field] = field_info[3]


def _validate_model(model):
    assert model['type'] in _SCHEMA['model'], \
        'element type missing from schema: {}'.format(model['type'])
    model_info = _SCHEMA['model'][model['type']]
    if 'name' in model_info:
        if 'name' not in model:
            model['name'] = '{}{}'.format(model['type'][0], 1)
    for f in model:
        if '{}.{}'.format(model['type'], f) in _IGNORE_FIELDS:
            continue
        _validate_field(model, f, model_info)
